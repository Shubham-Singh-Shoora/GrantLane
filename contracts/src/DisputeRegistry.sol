// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {GrantEscrow} from "./GrantEscrow.sol";
import {IOptimisticOracleV3} from "./interfaces/IOptimisticOracleV3.sol";

/// @title DisputeRegistry
/// @notice Disputes a GrantLane milestone claim together with the disputer's written
///         reason, and keeps every reason on-chain — including for disputes that lose.
/// @dev UMA's disputeAssertion has no field for a reason, and GrantEscrow is deployed
///      and unchanged, so this contract sits beside it. In one transaction it pulls the
///      dispute bond from the caller, disputes the claim on UMA naming the caller as the
///      disputer — so UMA pays any winnings to them, never to this contract — and records
///      the hash and location of their reason. Filing and disputing are atomic: a reason
///      can't be recorded without the dispute, or the dispute raised without the reason.
///
///      Anyone can still dispute directly on UMA; such a dispute simply has no reason
///      recorded here. The contract holds no funds between transactions.
contract DisputeRegistry is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Dispute {
        /// @dev The UMA assertion disputed — each claim on a milestone has its own.
        bytes32 assertionId;
        address disputer;
        uint64 filedAt;
        /// @dev keccak256 of the reason bundle published at reasonURI.
        bytes32 reasonHash;
        string reasonURI;
    }

    GrantEscrow public immutable escrow;
    IOptimisticOracleV3 public immutable oracle;
    IERC20 public immutable usdc;

    /// @dev grantId => milestoneId => every dispute filed through this contract, oldest first.
    mapping(uint256 => mapping(uint256 => Dispute[])) private s_disputes;

    event DisputeFiled(
        uint256 indexed grantId,
        uint256 indexed milestoneId,
        bytes32 indexed assertionId,
        address disputer,
        bytes32 reasonHash,
        string reasonURI
    );

    error EmptyReason();
    error UnknownMilestone(uint256 grantId, uint256 milestoneId);
    error NotOpenToDispute(GrantEscrow.MilestoneStatus status);

    constructor(GrantEscrow escrow_) {
        escrow = escrow_;
        oracle = escrow_.oracle();
        usdc = escrow_.usdc();
    }

    /// @notice Disputes a milestone's live claim and records why.
    /// @dev The caller must have approved this contract for the escrow's bond in USDC.
    ///      UMA itself refuses a dispute once the claim's window has closed.
    function dispute(uint256 grantId, uint256 milestoneId, bytes32 reasonHash, string calldata reasonURI)
        external
        nonReentrant
        returns (bytes32 assertionId)
    {
        if (reasonHash == bytes32(0) || bytes(reasonURI).length == 0) revert EmptyReason();

        GrantEscrow.Milestone[] memory milestones = escrow.getMilestones(grantId);
        if (milestoneId >= milestones.length) revert UnknownMilestone(grantId, milestoneId);
        GrantEscrow.Milestone memory milestone = milestones[milestoneId];
        if (milestone.status != GrantEscrow.MilestoneStatus.Asserted) revert NotOpenToDispute(milestone.status);
        assertionId = milestone.assertionId;

        s_disputes[grantId][milestoneId].push(
            Dispute({
                assertionId: assertionId,
                disputer: msg.sender,
                filedAt: uint64(block.timestamp),
                reasonHash: reasonHash,
                reasonURI: reasonURI
            })
        );
        emit DisputeFiled(grantId, milestoneId, assertionId, msg.sender, reasonHash, reasonURI);

        uint256 bond = escrow.bond();
        usdc.safeTransferFrom(msg.sender, address(this), bond);
        usdc.forceApprove(address(oracle), bond);
        oracle.disputeAssertion(assertionId, msg.sender);
    }

    /// @notice Every dispute filed against a milestone through this contract, oldest first.
    function disputesFor(uint256 grantId, uint256 milestoneId) external view returns (Dispute[] memory) {
        return s_disputes[grantId][milestoneId];
    }
}
