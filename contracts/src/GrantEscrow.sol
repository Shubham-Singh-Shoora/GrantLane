// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IOptimisticOracleV3} from "./interfaces/IOptimisticOracleV3.sol";
import {IOptimisticOracleV3CallbackRecipient} from "./interfaces/IOptimisticOracleV3CallbackRecipient.sol";
import {AutomationCompatibleInterface} from "./interfaces/AutomationCompatibleInterface.sol";

/// @title GrantEscrow
/// @notice Milestone grant escrow in USDC. A grantee claims a milestone by asserting it on
///         UMA's Optimistic Oracle V3 with a USDC bond. If nobody disputes the claim within
///         the liveness window it settles true and the milestone is paid. A dispute goes to
///         UMA for resolution, and whichever side was wrong forfeits its bond.
/// @dev Nothing in this contract judges the work. The oracle makes a false claim expensive
///      and gives the grantor — or anyone — a window to challenge it.
///
///      Settlement is permissionless. Chainlink Automation settles expired claims through
///      performUpkeep, and anyone can call settle() (or the oracle directly) if it does not.
///      Approved amounts are credited for withdrawal rather than pushed, so no token transfer
///      can block a settlement.
///
///      World ID Selfie Check gates two actions on-chain — claiming a milestone and changing
///      the payout wallet — through EIP-712 attestations signed by the server that verified
///      the proof.
contract GrantEscrow is
    Ownable,
    ReentrancyGuard,
    EIP712,
    IOptimisticOracleV3CallbackRecipient,
    AutomationCompatibleInterface
{
    using SafeERC20 for IERC20;

    enum MilestoneStatus {
        Pending,
        Asserted,
        Disputed,
        Approved,
        Rejected
    }

    struct Milestone {
        uint128 amount;
        /// @dev End of the current claim's liveness window; zero until first claimed.
        uint64 expiresAt;
        MilestoneStatus status;
        /// @dev UMA assertion for the current (or most recent) claim.
        bytes32 assertionId;
        bytes32 evidenceHash;
    }

    struct Grant {
        address funder;
        address grantee;
        address payoutWallet;
        uint128 totalAmount;
        /// @dev Sum of approved milestones — credited to a payout wallet, withdrawn or not.
        uint128 releasedAmount;
        /// @dev Milestones currently Asserted or Disputed. The grant cannot close while non-zero.
        uint32 openClaims;
        bool active;
        /// @dev Commitment to the off-chain milestone specification the claims are judged against.
        bytes32 termsHash;
    }

    /// @notice A server attestation that a World ID Selfie Check proof was verified.
    struct SelfieAttestation {
        bytes32 nullifierHash;
        /// @dev Unix seconds after which the attestation is stale.
        uint256 deadline;
        /// @dev EIP-712 signature by `attestor`.
        bytes signature;
    }

    /// @dev Maps an oracle assertion back to its milestone. `expiresAt` doubles as the
    ///      existence flag — it is never zero for a live claim.
    struct Claim {
        uint128 grantId;
        uint64 milestoneId;
        uint64 expiresAt;
    }

    bytes32 private constant PAYOUT_WALLET_TYPEHASH = keccak256(
        "PayoutWalletChange(uint256 grantId,address newWallet,bytes32 nullifierHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant MILESTONE_CLAIM_TYPEHASH = keccak256(
        "MilestoneClaim(uint256 grantId,uint256 milestoneId,bytes32 evidenceHash,bytes32 nullifierHash,uint256 nonce,uint256 deadline)"
    );

    uint256 public constant MAX_MILESTONES = 32;
    /// @notice Most claims a single performUpkeep will settle.
    uint256 public constant MAX_SETTLE_BATCH = 10;

    IOptimisticOracleV3 public immutable oracle;
    /// @notice Token for grant escrow and claim bonds alike.
    IERC20 public immutable usdc;
    /// @notice Bond a grantee posts per claim; a disputer must match it.
    uint256 public immutable bond;
    /// @notice Seconds a claim stays open to dispute.
    uint64 public immutable liveness;
    bytes32 public immutable identifier;

    uint256 public nextGrantId;
    /// @notice Server key that attests a Selfie Check proof was verified.
    address public attestor;

    /// @notice USDC owed to each payout wallet, claimable with withdraw().
    mapping(address => uint256) public pendingWithdrawals;
    /// @notice Per-grant nonce for payout-wallet changes.
    mapping(uint256 => uint256) public payoutWalletNonce;
    /// @notice Per-grant nonce for milestone claims, so an attestation cannot be replayed.
    mapping(uint256 => uint256) public claimNonce;
    /// @notice World ID nullifiers already spent on a payout-wallet change.
    mapping(bytes32 => bool) public usedNullifier;

    mapping(uint256 => Grant) private s_grants;
    mapping(uint256 => Milestone[]) private s_milestones;
    mapping(bytes32 => Claim) private s_claims;

    /// @dev Undisputed claims waiting out liveness — the set Automation watches.
    bytes32[] private s_awaitingSettlement;
    /// @dev Position in s_awaitingSettlement plus one; zero means absent.
    mapping(bytes32 => uint256) private s_awaitingIndex;

    event GrantCreated(
        uint256 indexed grantId, address indexed funder, address indexed grantee, uint128 totalAmount, bytes32 termsHash
    );
    event MilestoneClaimed(
        uint256 indexed grantId,
        uint256 indexed milestoneId,
        bytes32 indexed assertionId,
        bytes32 evidenceHash,
        string evidenceURI,
        uint64 expiresAt,
        bytes32 nullifierHash
    );
    event MilestoneDisputed(uint256 indexed grantId, uint256 indexed milestoneId, bytes32 indexed assertionId);
    event MilestoneApproved(
        uint256 indexed grantId, uint256 indexed milestoneId, bytes32 indexed assertionId, address payoutWallet, uint128 amount
    );
    event MilestoneRejected(uint256 indexed grantId, uint256 indexed milestoneId, bytes32 indexed assertionId);
    event AutoSettleFailed(bytes32 indexed assertionId, bytes reason);
    event Withdrawal(address indexed account, uint256 amount);
    event PayoutWalletChanged(
        uint256 indexed grantId, address indexed previous, address indexed current, bytes32 nullifierHash
    );
    event AttestorUpdated(address indexed previous, address indexed current);
    event GrantClosed(uint256 indexed grantId, address indexed refundTo, uint128 refunded);

    error ZeroAddress();
    error BondZero();
    error LivenessZero();
    error BondBelowMinimum(uint256 bond, uint256 minimum);
    error EmptyMilestones();
    error TooManyMilestones(uint256 count);
    error AmountZero();
    error EmptyTerms();
    error EmptyEvidence();
    error UnknownGrant(uint256 grantId);
    error UnknownMilestone(uint256 grantId, uint256 milestoneId);
    error NotGrantee(address caller);
    error NotFunder(address caller);
    error NotOracle(address caller);
    error GrantInactive(uint256 grantId);
    error MilestoneNotOpen(MilestoneStatus status);
    error MilestoneNotUnderReview(MilestoneStatus status);
    error LivenessNotOver(uint64 expiresAt);
    error ClaimsOpen(uint32 openClaims);
    error NothingToWithdraw();
    error AttestationExpired(uint256 deadline);
    error NullifierAlreadyUsed(bytes32 nullifierHash);
    error BadAttestation(address recovered, address expected);

    modifier onlyOracle() {
        if (msg.sender != address(oracle)) revert NotOracle(msg.sender);
        _;
    }

    constructor(IOptimisticOracleV3 oracle_, IERC20 usdc_, address attestor_, uint64 liveness_, uint256 bond_)
        Ownable(msg.sender)
        EIP712("GrantLane", "1")
    {
        if (address(oracle_) == address(0) || address(usdc_) == address(0) || attestor_ == address(0)) {
            revert ZeroAddress();
        }
        if (liveness_ == 0) revert LivenessZero();
        // A free claim makes lying free; the bond is the whole deterrent.
        if (bond_ == 0) revert BondZero();
        uint256 minimum = oracle_.getMinimumBond(address(usdc_));
        if (bond_ < minimum) revert BondBelowMinimum(bond_, minimum);

        oracle = oracle_;
        usdc = usdc_;
        liveness = liveness_;
        bond = bond_;
        identifier = oracle_.defaultIdentifier();

        attestor = attestor_;
        emit AttestorUpdated(address(0), attestor_);
    }

    // ---------------------------------------------------------------------
    // Funding
    // ---------------------------------------------------------------------

    /// @notice Creates a grant and escrows the full milestone total up front.
    /// @dev The caller must have approved `usdc` for the sum of `amounts`.
    /// @param termsHash Commitment to the milestone specification. Claims reference it, so
    ///        disputers and UMA voters judge against terms the grantor cannot later edit.
    function createGrant(address grantee, uint128[] calldata amounts, bytes32 termsHash)
        external
        nonReentrant
        returns (uint256 grantId)
    {
        if (grantee == address(0)) revert ZeroAddress();
        if (amounts.length == 0) revert EmptyMilestones();
        if (amounts.length > MAX_MILESTONES) revert TooManyMilestones(amounts.length);
        if (termsHash == bytes32(0)) revert EmptyTerms();

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
            totalAmount: total,
            releasedAmount: 0,
            openClaims: 0,
            active: true,
            termsHash: termsHash
        });

        for (uint256 i = 0; i < amounts.length; ++i) {
            s_milestones[grantId].push(
                Milestone({
                    amount: amounts[i],
                    expiresAt: 0,
                    status: MilestoneStatus.Pending,
                    assertionId: bytes32(0),
                    evidenceHash: bytes32(0)
                })
            );
        }

        usdc.safeTransferFrom(msg.sender, address(this), total);
        emit GrantCreated(grantId, msg.sender, grantee, total, termsHash);
    }

    // ---------------------------------------------------------------------
    // Claiming a milestone
    // ---------------------------------------------------------------------

    /// @notice Claims a milestone as delivered by asserting it on UMA with a bond.
    /// @dev The grantee must have approved this contract for `bond` USDC. The escrow pulls
    ///      the bond and posts it itself, because the oracle takes the bond from its caller;
    ///      the grantee is still the asserter, so an undisputed or upheld claim returns the
    ///      bond to them.
    /// @param evidenceURI Where the evidence lives. Written into the claim text.
    /// @param evidenceHash Content hash of the evidence bundle at `evidenceURI`.
    /// @param selfie Attestation that the grantee passed a Selfie Check for this claim.
    function submitMilestone(
        uint256 grantId,
        uint256 milestoneId,
        string calldata evidenceURI,
        bytes32 evidenceHash,
        SelfieAttestation calldata selfie
    ) external nonReentrant returns (bytes32 assertionId) {
        Grant storage grant = _grant(grantId);
        if (!grant.active) revert GrantInactive(grantId);
        if (msg.sender != grant.grantee) revert NotGrantee(msg.sender);
        if (bytes(evidenceURI).length == 0 || evidenceHash == bytes32(0)) revert EmptyEvidence();

        Milestone storage milestone = _milestone(grantId, milestoneId);
        if (milestone.status != MilestoneStatus.Pending && milestone.status != MilestoneStatus.Rejected) {
            revert MilestoneNotOpen(milestone.status);
        }

        // World ID nullifiers are stable per person per action, so they cannot be single-use
        // here without blocking a grantee's second milestone. The per-grant nonce is what
        // stops an attestation being replayed.
        uint256 nonce = claimNonce[grantId];
        _checkAttestation(
            keccak256(
                abi.encode(
                    MILESTONE_CLAIM_TYPEHASH, grantId, milestoneId, evidenceHash, selfie.nullifierHash, nonce, selfie.deadline
                )
            ),
            selfie
        );
        claimNonce[grantId] = nonce + 1;

        uint64 expiresAt = uint64(block.timestamp) + liveness;
        milestone.status = MilestoneStatus.Asserted;
        milestone.evidenceHash = evidenceHash;
        milestone.expiresAt = expiresAt;
        grant.openClaims += 1;

        assertionId = _assert(_claimText(grantId, milestoneId, evidenceURI));

        milestone.assertionId = assertionId;
        s_claims[assertionId] = Claim(uint128(grantId), uint64(milestoneId), expiresAt);
        _watch(assertionId);

        emit MilestoneClaimed(grantId, milestoneId, assertionId, evidenceHash, evidenceURI, expiresAt, selfie.nullifierHash);
    }

    /// @notice Settles a claim once its liveness window has passed, or once UMA has resolved
    ///         its dispute. Anyone may call it.
    /// @dev A thin convenience over oracle.settleAssertion, which is itself permissionless;
    ///      the payout happens in the oracle's callback either way.
    function settle(uint256 grantId, uint256 milestoneId) external nonReentrant {
        _grant(grantId);
        Milestone storage milestone = _milestone(grantId, milestoneId);
        if (milestone.status == MilestoneStatus.Asserted) {
            if (block.timestamp < milestone.expiresAt) revert LivenessNotOver(milestone.expiresAt);
        } else if (milestone.status != MilestoneStatus.Disputed) {
            revert MilestoneNotUnderReview(milestone.status);
        }
        oracle.settleAssertion(milestone.assertionId);
    }

    /// @notice Sends the caller everything credited to them by approved milestones.
    function withdraw() external nonReentrant returns (uint256 amount) {
        amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        pendingWithdrawals[msg.sender] = 0;
        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawal(msg.sender, amount);
    }

    // ---------------------------------------------------------------------
    // UMA callbacks
    // ---------------------------------------------------------------------

    /// @inheritdoc IOptimisticOracleV3CallbackRecipient
    /// @dev Called by the oracle inside settleAssertion. It only moves internal balances,
    ///      so it cannot fail on a token transfer and hold the settlement hostage. Assertions
    ///      this escrow did not make are ignored rather than reverted: anyone can name this
    ///      contract as a callback recipient, and reverting would only strand their bond.
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external onlyOracle {
        Claim memory claim = s_claims[assertionId];
        if (claim.expiresAt == 0) return;

        delete s_claims[assertionId];
        _unwatch(assertionId);

        Grant storage grant = s_grants[claim.grantId];
        Milestone storage milestone = s_milestones[claim.grantId][claim.milestoneId];
        grant.openClaims -= 1;

        if (assertedTruthfully) {
            uint128 amount = milestone.amount;
            address payoutWallet = grant.payoutWallet;
            milestone.status = MilestoneStatus.Approved;
            grant.releasedAmount += amount;
            pendingWithdrawals[payoutWallet] += amount;
            emit MilestoneApproved(claim.grantId, claim.milestoneId, assertionId, payoutWallet, amount);
        } else {
            // The milestone reopens; the grantee can claim it again with better evidence.
            milestone.status = MilestoneStatus.Rejected;
            emit MilestoneRejected(claim.grantId, claim.milestoneId, assertionId);
        }
    }

    /// @inheritdoc IOptimisticOracleV3CallbackRecipient
    /// @dev A disputed claim waits for UMA's answer, so Automation stops watching it.
    function assertionDisputedCallback(bytes32 assertionId) external onlyOracle {
        Claim memory claim = s_claims[assertionId];
        if (claim.expiresAt == 0) return;

        _unwatch(assertionId);
        s_milestones[claim.grantId][claim.milestoneId].status = MilestoneStatus.Disputed;
        emit MilestoneDisputed(claim.grantId, claim.milestoneId, assertionId);
    }

    // ---------------------------------------------------------------------
    // Chainlink Automation
    // ---------------------------------------------------------------------

    /// @inheritdoc AutomationCompatibleInterface
    /// @dev Simulated off-chain. Scans every undisputed claim; the set only holds claims
    ///      inside their liveness window, so it stays small.
    function checkUpkeep(bytes calldata)
        external
        view
        override
        returns (bool upkeepNeeded, bytes memory performData)
    {
        bytes32[] memory ready = new bytes32[](MAX_SETTLE_BATCH);
        uint256 count;
        uint256 length = s_awaitingSettlement.length;
        for (uint256 i = 0; i < length && count < MAX_SETTLE_BATCH; ++i) {
            bytes32 assertionId = s_awaitingSettlement[i];
            if (s_claims[assertionId].expiresAt <= block.timestamp) {
                ready[count++] = assertionId;
            }
        }
        if (count == 0) return (false, "");

        bytes32[] memory batch = new bytes32[](count);
        for (uint256 i = 0; i < count; ++i) {
            batch[i] = ready[i];
        }
        return (true, abi.encode(batch));
    }

    /// @inheritdoc AutomationCompatibleInterface
    /// @dev Open to anyone, because it can only do what settle() already allows: every id is
    ///      re-checked, since performData is caller-supplied and may be stale by the time it
    ///      lands. One failing settlement does not stop the rest of the batch.
    function performUpkeep(bytes calldata performData) external override nonReentrant {
        bytes32[] memory ids = abi.decode(performData, (bytes32[]));
        uint256 length = ids.length < MAX_SETTLE_BATCH ? ids.length : MAX_SETTLE_BATCH;
        for (uint256 i = 0; i < length; ++i) {
            bytes32 assertionId = ids[i];
            if (s_awaitingIndex[assertionId] == 0) continue;
            if (s_claims[assertionId].expiresAt > block.timestamp) continue;
            try oracle.settleAssertion(assertionId) {}
            catch (bytes memory reason) {
                emit AutoSettleFailed(assertionId, reason);
            }
        }
    }

    // ---------------------------------------------------------------------
    // Selfie-Check-gated payout wallet change
    // ---------------------------------------------------------------------

    /// @notice Repoints the payout wallet for a grant, gated on a fresh World ID Selfie Check.
    /// @dev The application server verifies the IDKit proof against the World verify endpoint,
    ///      then signs this change with the attestor key. A nullifier can only be spent once.
    ///      Already-approved milestones stay credited to the wallet that was current then.
    function changePayoutWallet(uint256 grantId, address newWallet, SelfieAttestation calldata selfie) external {
        if (newWallet == address(0)) revert ZeroAddress();
        if (usedNullifier[selfie.nullifierHash]) revert NullifierAlreadyUsed(selfie.nullifierHash);

        Grant storage grant = _grant(grantId);
        if (!grant.active) revert GrantInactive(grantId);
        if (msg.sender != grant.grantee) revert NotGrantee(msg.sender);

        uint256 nonce = payoutWalletNonce[grantId];
        _checkAttestation(
            keccak256(abi.encode(PAYOUT_WALLET_TYPEHASH, grantId, newWallet, selfie.nullifierHash, nonce, selfie.deadline)),
            selfie
        );

        usedNullifier[selfie.nullifierHash] = true;
        payoutWalletNonce[grantId] = nonce + 1;

        address previous = grant.payoutWallet;
        grant.payoutWallet = newWallet;
        emit PayoutWalletChanged(grantId, previous, newWallet, selfie.nullifierHash);
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
    /// @dev Blocked while any claim is under review, so a grantor cannot pull the funds out
    ///      from under a claim they expect to lose. Credited payouts stay withdrawable.
    function closeGrant(uint256 grantId) external nonReentrant {
        Grant storage grant = _grant(grantId);
        if (!grant.active) revert GrantInactive(grantId);
        if (msg.sender != grant.funder) revert NotFunder(msg.sender);
        if (grant.openClaims != 0) revert ClaimsOpen(grant.openClaims);

        grant.active = false;
        uint128 refund = grant.totalAmount - grant.releasedAmount;
        emit GrantClosed(grantId, grant.funder, refund);

        if (refund > 0) {
            usdc.safeTransfer(grant.funder, refund);
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

    /// @notice Undisputed claims still waiting to be settled.
    function awaitingSettlement() external view returns (bytes32[] memory) {
        return s_awaitingSettlement;
    }

    /// @notice EIP-712 domain separator, exposed so the server can build attestations.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _assert(bytes memory claimText) private returns (bytes32) {
        usdc.safeTransferFrom(msg.sender, address(this), bond);
        usdc.forceApprove(address(oracle), bond);
        return oracle.assertTruth(
            claimText, msg.sender, address(this), address(0), liveness, usdc, bond, identifier, bytes32(0)
        );
    }

    /// @dev The claim is what a disputer or UMA voter reads, so it has to stand on its own:
    ///      which milestone, which terms, where the evidence is, and what paying it releases.
    function _claimText(uint256 grantId, uint256 milestoneId, string calldata evidenceURI)
        private
        view
        returns (bytes memory)
    {
        Milestone storage milestone = s_milestones[grantId][milestoneId];
        string memory what = string.concat(
            "GrantLane milestone claim. The grantee of grant ",
            Strings.toString(grantId),
            " asserts that milestone index ",
            Strings.toString(milestoneId),
            " has been delivered as specified in the grant terms committed on-chain as ",
            Strings.toHexString(uint256(s_grants[grantId].termsHash), 32),
            "."
        );
        string memory evidence = string.concat(
            " Evidence: ",
            evidenceURI,
            " (evidence hash ",
            Strings.toHexString(uint256(milestone.evidenceHash), 32),
            ")."
        );
        string memory payout = string.concat(
            " If true, escrow ",
            Strings.toHexString(address(this)),
            " on chain ",
            Strings.toString(block.chainid),
            " releases ",
            Strings.toString(milestone.amount),
            " USDC base units (6 decimals) to the grantee."
        );
        return bytes(string.concat(what, evidence, payout));
    }

    function _checkAttestation(bytes32 structHash, SelfieAttestation calldata selfie) private view {
        if (block.timestamp > selfie.deadline) revert AttestationExpired(selfie.deadline);
        address expected = attestor;
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), selfie.signature);
        if (recovered != expected) revert BadAttestation(recovered, expected);
    }

    function _watch(bytes32 assertionId) private {
        s_awaitingSettlement.push(assertionId);
        s_awaitingIndex[assertionId] = s_awaitingSettlement.length;
    }

    function _unwatch(bytes32 assertionId) private {
        uint256 position = s_awaitingIndex[assertionId];
        if (position == 0) return;
        uint256 last = s_awaitingSettlement.length;
        if (position != last) {
            bytes32 moved = s_awaitingSettlement[last - 1];
            s_awaitingSettlement[position - 1] = moved;
            s_awaitingIndex[moved] = position;
        }
        s_awaitingSettlement.pop();
        delete s_awaitingIndex[assertionId];
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
