// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GrantEscrow} from "../src/GrantEscrow.sol";
import {DisputeRegistry} from "../src/DisputeRegistry.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";
import {MockOptimisticOracleV3} from "./mocks/MockOptimisticOracleV3.sol";
import {MockUSDC} from "./GrantEscrow.t.sol";

contract DisputeRegistryTest is Test {
    GrantEscrow internal escrow;
    DisputeRegistry internal registry;
    MockOptimisticOracleV3 internal oracle;
    MockUSDC internal usdc;

    address internal funder = makeAddr("funder");
    address internal grantee = makeAddr("grantee");
    address internal disputer = makeAddr("disputer");

    uint256 internal attestorKey = 0xA11CE;

    bytes32 private constant MILESTONE_CLAIM_TYPEHASH = keccak256(
        "MilestoneClaim(uint256 grantId,uint256 milestoneId,bytes32 evidenceHash,bytes32 nullifierHash,uint256 nonce,uint256 deadline)"
    );

    uint64 constant LIVENESS = 300;
    uint256 constant BOND = 1e6;
    uint256 constant BURN = BOND / 2;
    uint128 constant M0 = 600e6;

    bytes32 constant EVIDENCE = keccak256("evidence bundle");
    bytes32 constant REASON = keccak256("the demo link returns a 404 and the repo has no release");
    string constant REASON_URI = "https://grantlane.app/dispute/0x01";

    uint256 internal grantId;

    function setUp() public {
        usdc = new MockUSDC();
        oracle = new MockOptimisticOracleV3(0);
        escrow = new GrantEscrow(
            IOptimisticOracleV3(address(oracle)), IERC20(address(usdc)), vm.addr(attestorKey), LIVENESS, BOND
        );
        registry = new DisputeRegistry(escrow);

        usdc.mint(funder, 10_000e6);
        usdc.mint(grantee, 100e6);
        usdc.mint(disputer, 100e6);

        vm.prank(funder);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(grantee);
        usdc.approve(address(escrow), type(uint256).max);
        vm.prank(disputer);
        usdc.approve(address(registry), type(uint256).max);

        uint128[] memory amounts = new uint128[](2);
        amounts[0] = M0;
        amounts[1] = 400e6;
        vm.prank(funder);
        grantId = escrow.createGrant(grantee, amounts, keccak256("terms"));
    }

    function _submit(uint256 milestoneId) internal returns (bytes32) {
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 nullifier = keccak256("nullifier");
        bytes32 structHash = keccak256(
            abi.encode(
                MILESTONE_CLAIM_TYPEHASH, grantId, milestoneId, EVIDENCE, nullifier, escrow.claimNonce(grantId), deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorKey, digest);
        vm.prank(grantee);
        return escrow.submitMilestone(
            grantId, milestoneId, "https://evidence", EVIDENCE, GrantEscrow.SelfieAttestation(nullifier, deadline, abi.encodePacked(r, s, v))
        );
    }

    function _status(uint256 milestoneId) internal view returns (GrantEscrow.MilestoneStatus) {
        return escrow.getMilestones(grantId)[milestoneId].status;
    }

    function test_dispute_filesOnUmaInTheCallersNameAndRecordsTheReason() public {
        bytes32 assertionId = _submit(0);
        uint256 before = usdc.balanceOf(disputer);

        vm.expectEmit(address(registry));
        emit DisputeRegistry.DisputeFiled(grantId, 0, assertionId, disputer, REASON, REASON_URI);
        vm.prank(disputer);
        bytes32 disputed = registry.dispute(grantId, 0, REASON, REASON_URI);

        assertEq(disputed, assertionId);
        assertEq(uint8(_status(0)), uint8(GrantEscrow.MilestoneStatus.Disputed), "escrow saw the dispute");
        assertEq(oracle.getAssertion(assertionId).disputer, disputer, "UMA names the caller, not the registry");
        assertEq(before - usdc.balanceOf(disputer), BOND, "bond taken from the disputer");
        assertEq(usdc.balanceOf(address(registry)), 0, "registry keeps nothing");
        assertEq(usdc.allowance(address(registry), address(oracle)), 0, "no leftover allowance");

        DisputeRegistry.Dispute[] memory ds = registry.disputesFor(grantId, 0);
        assertEq(ds.length, 1);
        assertEq(ds[0].assertionId, assertionId);
        assertEq(ds[0].disputer, disputer);
        assertEq(ds[0].filedAt, block.timestamp);
        assertEq(ds[0].reasonHash, REASON);
        assertEq(ds[0].reasonURI, REASON_URI);
    }

    function test_dispute_requiresAReason() public {
        _submit(0);
        vm.startPrank(disputer);
        vm.expectRevert(DisputeRegistry.EmptyReason.selector);
        registry.dispute(grantId, 0, bytes32(0), REASON_URI);
        vm.expectRevert(DisputeRegistry.EmptyReason.selector);
        registry.dispute(grantId, 0, REASON, "");
        vm.stopPrank();
    }

    function test_dispute_onlyAgainstALiveClaim() public {
        vm.prank(disputer);
        vm.expectRevert(
            abi.encodeWithSelector(DisputeRegistry.NotOpenToDispute.selector, GrantEscrow.MilestoneStatus.Pending)
        );
        registry.dispute(grantId, 0, REASON, REASON_URI);

        _submit(0);
        vm.prank(disputer);
        registry.dispute(grantId, 0, REASON, REASON_URI);

        vm.prank(disputer);
        vm.expectRevert(
            abi.encodeWithSelector(DisputeRegistry.NotOpenToDispute.selector, GrantEscrow.MilestoneStatus.Disputed)
        );
        registry.dispute(grantId, 0, REASON, REASON_URI);
    }

    function test_dispute_unknownMilestone() public {
        vm.prank(disputer);
        vm.expectRevert(abi.encodeWithSelector(DisputeRegistry.UnknownMilestone.selector, grantId, 9));
        registry.dispute(grantId, 9, REASON, REASON_URI);
    }

    function test_dispute_afterTheWindowCloses() public {
        _submit(0);
        vm.warp(block.timestamp + LIVENESS);
        vm.prank(disputer);
        vm.expectRevert(bytes("Assertion is expired"));
        registry.dispute(grantId, 0, REASON, REASON_URI);
        assertEq(registry.disputesFor(grantId, 0).length, 0, "nothing recorded without a dispute");
    }

    function test_dispute_winningsGoToTheDisputer() public {
        bytes32 assertionId = _submit(0);
        uint256 before = usdc.balanceOf(disputer);
        vm.prank(disputer);
        registry.dispute(grantId, 0, REASON, REASON_URI);

        oracle.resolveDispute(assertionId, false);
        escrow.settle(grantId, 0);

        assertEq(uint8(_status(0)), uint8(GrantEscrow.MilestoneStatus.Rejected));
        assertEq(usdc.balanceOf(disputer) - before, BOND - BURN, "disputer nets the grantee's bond less the burn");
        assertEq(usdc.balanceOf(address(registry)), 0);
    }

    /// @dev The point of recording the reason on-chain: a dispute that loses stays visible.
    function test_dispute_aLostDisputeStaysOnRecord() public {
        bytes32 assertionId = _submit(0);
        vm.prank(disputer);
        registry.dispute(grantId, 0, REASON, REASON_URI);

        oracle.resolveDispute(assertionId, true);
        escrow.settle(grantId, 0);

        assertEq(uint8(_status(0)), uint8(GrantEscrow.MilestoneStatus.Approved), "grantee was right");
        DisputeRegistry.Dispute[] memory ds = registry.disputesFor(grantId, 0);
        assertEq(ds.length, 1, "the losing dispute's reason is still recorded");
        assertEq(ds[0].reasonHash, REASON);
    }

    function test_dispute_keepsHistoryAcrossReclaims() public {
        bytes32 first = _submit(0);
        vm.prank(disputer);
        registry.dispute(grantId, 0, REASON, REASON_URI);
        oracle.resolveDispute(first, false);
        escrow.settle(grantId, 0);

        bytes32 second = _submit(0);
        bytes32 secondReason = keccak256("still no release tag");
        vm.prank(disputer);
        registry.dispute(grantId, 0, secondReason, "https://grantlane.app/dispute/0x02");

        DisputeRegistry.Dispute[] memory ds = registry.disputesFor(grantId, 0);
        assertEq(ds.length, 2);
        assertEq(ds[0].assertionId, first);
        assertEq(ds[1].assertionId, second);
        assertEq(ds[1].reasonHash, secondReason);
        assertEq(registry.disputesFor(grantId, 1).length, 0, "other milestones unaffected");
    }
}
