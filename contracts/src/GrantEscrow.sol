// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReceiverTemplate} from "./ReceiverTemplate.sol";

/// @title GrantEscrow
/// @notice Milestone-based grant escrow settled on Arc. A CRE workflow scores milestone
///         evidence inside a TEE and delivers a DON-signed report; this contract releases
///         USDC to the grantee when that report approves a milestone.
/// @dev Payout-wallet changes are gated on a World ID Selfie Check that the application
///      server verifies off-chain and then attests to with an EIP-712 signature.
contract GrantEscrow is ReceiverTemplate, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    enum MilestoneStatus {
        Pending,
        Submitted,
        Approved,
        Rejected,
        Paid
    }

    struct Milestone {
        uint128 amount;
        uint128 paidAmount;
        MilestoneStatus status;
        uint16 scoreBps;
        bytes32 evidenceHash;
    }

    struct Grant {
        address funder;
        address grantee;
        address payoutWallet;
        IERC20 token;
        uint128 totalAmount;
        uint128 releasedAmount;
        bool active;
    }

    /// @dev EIP-712 struct hash for a server-attested Selfie Check.
    bytes32 private constant PAYOUT_WALLET_TYPEHASH = keccak256(
        "PayoutWalletChange(uint256 grantId,address newWallet,bytes32 nullifierHash,uint256 nonce,uint256 deadline)"
    );

    uint256 public nextGrantId;
    /// @notice Server key allowed to attest that a Selfie Check proof was verified.
    address public attestor;

    mapping(uint256 => Grant) private s_grants;
    mapping(uint256 => Milestone[]) private s_milestones;
    /// @notice Per-grant nonce, incremented on every successful payout-wallet change.
    mapping(uint256 => uint256) public payoutWalletNonce;
    /// @notice World ID nullifiers already spent on a payout-wallet change.
    mapping(bytes32 => bool) public usedNullifier;

    event GrantCreated(
        uint256 indexed grantId, address indexed funder, address indexed grantee, address token, uint128 totalAmount
    );
    event EvidenceSubmitted(uint256 indexed grantId, uint256 indexed milestoneId, bytes32 evidenceHash);
    event MilestoneApproved(uint256 indexed grantId, uint256 indexed milestoneId, uint16 scoreBps, uint128 payoutAmount);
    event MilestoneRejected(uint256 indexed grantId, uint256 indexed milestoneId, uint16 scoreBps);
    event MilestonePaid(uint256 indexed grantId, uint256 indexed milestoneId, address indexed to, uint128 amount);
    event PayoutWalletChanged(
        uint256 indexed grantId, address indexed previous, address indexed current, bytes32 nullifierHash
    );
    event AttestorUpdated(address indexed previous, address indexed current);
    event GrantClosed(uint256 indexed grantId, address indexed refundTo, uint128 refunded);

    error EmptyMilestones();
    error AmountZero();
    error UnknownGrant(uint256 grantId);
    error UnknownMilestone(uint256 grantId, uint256 milestoneId);
    error NotGrantee(address caller);
    error NotFunder(address caller);
    error GrantInactive(uint256 grantId);
    error MilestoneNotOpen(MilestoneStatus status);
    error MilestoneNotSubmitted(MilestoneStatus status);
    error PayoutExceedsMilestone(uint128 requested, uint128 available);
    error AttestationExpired(uint256 deadline);
    error NullifierAlreadyUsed(bytes32 nullifierHash);
    error BadAttestation(address recovered, address expected);
    error AttestorNotSet();

    constructor(address forwarderAddress, address attestor_)
        ReceiverTemplate(forwarderAddress)
        EIP712("GrantLane", "1")
    {
        if (attestor_ == address(0)) revert ZeroAddress();
        attestor = attestor_;
        emit AttestorUpdated(address(0), attestor_);
    }

    // ---------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------

    /// @notice Creates a grant and escrows the full milestone total up front.
    /// @dev The caller must have approved `token` for the sum of `amounts`.
    function createGrant(address grantee, IERC20 token, uint128[] calldata amounts)
        external
        nonReentrant
        returns (uint256 grantId)
    {
        if (grantee == address(0) || address(token) == address(0)) revert ZeroAddress();
        if (amounts.length == 0) revert EmptyMilestones();

        uint128 total;
        for (uint256 i = 0; i < amounts.length; ++i) {
            if (amounts[i] == 0) revert AmountZero();
            total += amounts[i];
        }

        grantId = nextGrantId++;
        s_grants[grantId] = Grant({
            funder: msg.sender,
            grantee: grantee,
            payoutWallet: grantee,
            token: token,
            totalAmount: total,
            releasedAmount: 0,
            active: true
        });

        for (uint256 i = 0; i < amounts.length; ++i) {
            s_milestones[grantId].push(
                Milestone({
                    amount: amounts[i],
                    paidAmount: 0,
                    status: MilestoneStatus.Pending,
                    scoreBps: 0,
                    evidenceHash: bytes32(0)
                })
            );
        }

        token.safeTransferFrom(msg.sender, address(this), total);
        emit GrantCreated(grantId, msg.sender, grantee, address(token), total);
    }

    /// @notice Grantee records a content hash of the evidence bundle for a milestone.
    /// @dev The evidence itself lives off-chain; the CRE workflow reads it and scores it.
    function submitEvidence(uint256 grantId, uint256 milestoneId, bytes32 evidenceHash) external {
        Grant storage grant = _grant(grantId);
        if (!grant.active) revert GrantInactive(grantId);
        if (msg.sender != grant.grantee) revert NotGrantee(msg.sender);

        Milestone storage milestone = _milestone(grantId, milestoneId);
        if (milestone.status != MilestoneStatus.Pending && milestone.status != MilestoneStatus.Rejected) {
            revert MilestoneNotOpen(milestone.status);
        }

        milestone.evidenceHash = evidenceHash;
        milestone.status = MilestoneStatus.Submitted;
        emit EvidenceSubmitted(grantId, milestoneId, evidenceHash);
    }

    // ---------------------------------------------------------------------
    // CRE report handling
    // ---------------------------------------------------------------------

    /// @inheritdoc ReceiverTemplate
    /// @dev Report payload is `abi.encode(uint256 grantId, uint256 milestoneId, bool approved,
    ///      uint128 payoutAmount, uint16 scoreBps)`, produced by the grant-evaluation workflow.
    function _processReport(bytes calldata report) internal override nonReentrant {
        (uint256 grantId, uint256 milestoneId, bool approved, uint128 payoutAmount, uint16 scoreBps) =
            abi.decode(report, (uint256, uint256, bool, uint128, uint16));

        Grant storage grant = _grant(grantId);
        if (!grant.active) revert GrantInactive(grantId);

        Milestone storage milestone = _milestone(grantId, milestoneId);
        if (milestone.status != MilestoneStatus.Submitted) revert MilestoneNotSubmitted(milestone.status);

        milestone.scoreBps = scoreBps;

        if (!approved) {
            milestone.status = MilestoneStatus.Rejected;
            emit MilestoneRejected(grantId, milestoneId, scoreBps);
            return;
        }

        uint128 available = milestone.amount - milestone.paidAmount;
        if (payoutAmount > available) revert PayoutExceedsMilestone(payoutAmount, available);

        // Effects before interaction.
        milestone.paidAmount += payoutAmount;
        milestone.status = payoutAmount == available ? MilestoneStatus.Paid : MilestoneStatus.Approved;
        grant.releasedAmount += payoutAmount;

        emit MilestoneApproved(grantId, milestoneId, scoreBps, payoutAmount);

        address to = grant.payoutWallet;
        grant.token.safeTransfer(to, payoutAmount);
        emit MilestonePaid(grantId, milestoneId, to, payoutAmount);
    }

    // ---------------------------------------------------------------------
    // Selfie-Check-gated payout wallet change
    // ---------------------------------------------------------------------

    /// @notice Repoints the payout wallet for a grant, gated on a fresh World ID Selfie Check.
    /// @dev The application server verifies the IDKit proof against the World verify endpoint,
    ///      then signs this struct with the attestor key. A nullifier can only be spent once.
    /// @param nullifierHash Nullifier from the verified Selfie Check proof.
    /// @param deadline Unix seconds after which the attestation is stale.
    /// @param signature EIP-712 signature by `attestor`.
    function changePayoutWallet(
        uint256 grantId,
        address newWallet,
        bytes32 nullifierHash,
        uint256 deadline,
        bytes calldata signature
    ) external {
        if (newWallet == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert AttestationExpired(deadline);
        if (usedNullifier[nullifierHash]) revert NullifierAlreadyUsed(nullifierHash);

        Grant storage grant = _grant(grantId);
        if (!grant.active) revert GrantInactive(grantId);
        if (msg.sender != grant.grantee) revert NotGrantee(msg.sender);

        address expected = attestor;
        if (expected == address(0)) revert AttestorNotSet();

        uint256 nonce = payoutWalletNonce[grantId];
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(PAYOUT_WALLET_TYPEHASH, grantId, newWallet, nullifierHash, nonce, deadline))
        );
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != expected) revert BadAttestation(recovered, expected);

        usedNullifier[nullifierHash] = true;
        payoutWalletNonce[grantId] = nonce + 1;

        address previous = grant.payoutWallet;
        grant.payoutWallet = newWallet;
        emit PayoutWalletChanged(grantId, previous, newWallet, nullifierHash);
    }

    function setAttestor(address attestor_) external onlyOwner {
        if (attestor_ == address(0)) revert ZeroAddress();
        emit AttestorUpdated(attestor, attestor_);
        attestor = attestor_;
    }

    // ---------------------------------------------------------------------
    // Funder exit
    // ---------------------------------------------------------------------

    /// @notice Closes a grant and refunds whatever has not been released to the funder.
    function closeGrant(uint256 grantId) external nonReentrant {
        Grant storage grant = _grant(grantId);
        if (!grant.active) revert GrantInactive(grantId);
        if (msg.sender != grant.funder) revert NotFunder(msg.sender);

        grant.active = false;
        uint128 refund = grant.totalAmount - grant.releasedAmount;
        emit GrantClosed(grantId, grant.funder, refund);

        if (refund > 0) {
            grant.token.safeTransfer(grant.funder, refund);
        }
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getGrant(uint256 grantId) external view returns (Grant memory) {
        return _grant(grantId);
    }

    function getMilestones(uint256 grantId) external view returns (Milestone[] memory) {
        _grant(grantId);
        return s_milestones[grantId];
    }

    function milestoneCount(uint256 grantId) external view returns (uint256) {
        _grant(grantId);
        return s_milestones[grantId].length;
    }

    /// @notice EIP-712 domain separator, exposed so the server can build attestations.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function _grant(uint256 grantId) private view returns (Grant storage grant) {
        grant = s_grants[grantId];
        if (grant.grantee == address(0)) revert UnknownGrant(grantId);
    }

    function _milestone(uint256 grantId, uint256 milestoneId) private view returns (Milestone storage) {
        Milestone[] storage list = s_milestones[grantId];
        if (milestoneId >= list.length) revert UnknownMilestone(grantId, milestoneId);
        return list[milestoneId];
    }
}
