// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GrantEscrow} from "../src/GrantEscrow.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";
import {IMockOracleAncillary, UmaSandbox} from "../script/UmaSandbox.sol";

/// @notice GrantEscrow against the real UMA Optimistic Oracle V3 and Circle USDC on a
///         Base Sepolia fork. Skipped unless BASE_SEPOLIA_RPC_URL is set.
/// @dev Where the unit tests trust a mock's reading of UMA's rules, these run the real
///      contracts: bond whitelisting, the callback wiring, the dispute request, the 50%
///      burn, and resolution through UMA's sandbox oracle.
contract GrantEscrowForkTest is Test {
    IOptimisticOracleV3 internal constant OO = IOptimisticOracleV3(0x0F7fC5E6482f096380db6158f978167b57388deE);
    IMockOracleAncillary internal constant UMA_SANDBOX = IMockOracleAncillary(0x54e38A62ED3dC88e2B80cBA50deB940580511D26);
    IERC20 internal constant USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);

    bytes32 private constant MILESTONE_CLAIM_TYPEHASH = keccak256(
        "MilestoneClaim(uint256 grantId,uint256 milestoneId,bytes32 evidenceHash,bytes32 nullifierHash,uint256 nonce,uint256 deadline)"
    );

    uint64 constant LIVENESS = 300;
    uint256 constant BOND = 1e6;
    uint256 constant BURN = BOND / 2;
    uint128 constant M0 = 3e6;
    uint128 constant M1 = 2e6;
    string constant EVIDENCE_URI = "https://github.com/Shubham-Singh-Shoora/GrantLane";
    bytes32 constant EVIDENCE = keccak256("fork evidence bundle");

    GrantEscrow internal escrow;
    uint256 internal grantId;

    uint256 internal attestorKey = 0xA11CE;
    address internal funder = makeAddr("fork-funder");
    address internal grantee = makeAddr("fork-grantee");
    address internal keeper = makeAddr("fork-keeper");

    function setUp() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);

        escrow = new GrantEscrow(OO, USDC, vm.addr(attestorKey), LIVENESS, BOND);

        deal(address(USDC), funder, 100e6);
        deal(address(USDC), grantee, 10e6);

        vm.startPrank(funder);
        USDC.approve(address(escrow), type(uint256).max);
        USDC.approve(address(OO), type(uint256).max);
        uint128[] memory amounts = new uint128[](2);
        amounts[0] = M0;
        amounts[1] = M1;
        grantId = escrow.createGrant(grantee, amounts, keccak256("fork terms"));
        vm.stopPrank();

        vm.prank(grantee);
        USDC.approve(address(escrow), type(uint256).max);
    }

    function _submit(uint256 milestoneId) internal returns (bytes32) {
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 nullifier = keccak256("fork nullifier");
        bytes32 structHash = keccak256(
            abi.encode(
                MILESTONE_CLAIM_TYPEHASH, grantId, milestoneId, EVIDENCE, nullifier, escrow.claimNonce(grantId), deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorKey, digest);

        vm.prank(grantee);
        return escrow.submitMilestone(
            grantId, milestoneId, EVIDENCE_URI, EVIDENCE, GrantEscrow.SelfieAttestation(nullifier, deadline, abi.encodePacked(r, s, v))
        );
    }

    /// @dev The oracle asks for a price at the assertion's own timestamp.
    function _answerDispute(bytes32 assertionId, uint256 assertionTime, int256 answer) internal {
        UMA_SANDBOX.pushPrice(
            escrow.identifier(), assertionTime, UmaSandbox.disputeAncillaryData(assertionId, grantee), answer
        );
    }

    function _status(uint256 milestoneId) internal view returns (uint8) {
        return uint8(escrow.getMilestones(grantId)[milestoneId].status);
    }

    function test_fork_escrowAcceptsRealOracleTerms() public view {
        assertEq(escrow.identifier(), bytes32("ASSERT_TRUTH"), "UMA default identifier");
        assertGe(escrow.bond(), OO.getMinimumBond(address(USDC)), "USDC bond clears UMA minimum");
    }

    function test_fork_undisputedClaimPaysOut() public {
        bytes32 assertionId = _submit(0);
        uint256 afterBond = USDC.balanceOf(grantee);

        vm.expectRevert(bytes("Assertion not expired"));
        OO.settleAssertion(assertionId);

        vm.warp(block.timestamp + LIVENESS);
        vm.prank(keeper);
        escrow.settle(grantId, 0);

        assertTrue(OO.getAssertionResult(assertionId), "UMA recorded true");
        assertEq(_status(0), uint8(GrantEscrow.MilestoneStatus.Approved));
        assertEq(USDC.balanceOf(grantee) - afterBond, BOND, "bond returned by UMA");

        vm.prank(grantee);
        escrow.withdraw();
        assertEq(USDC.balanceOf(grantee) - afterBond, BOND + M0, "milestone paid in USDC");
    }

    function test_fork_disputeUpheldByUma() public {
        bytes32 assertionId = _submit(0);
        uint256 assertionTime = block.timestamp;
        uint256 afterBond = USDC.balanceOf(grantee);

        vm.prank(funder);
        OO.disputeAssertion(assertionId, funder);
        assertEq(_status(0), uint8(GrantEscrow.MilestoneStatus.Disputed));

        _answerDispute(assertionId, assertionTime, UmaSandbox.TRUE);
        escrow.settle(grantId, 0);

        assertEq(_status(0), uint8(GrantEscrow.MilestoneStatus.Approved));
        assertEq(escrow.pendingWithdrawals(grantee), M0);
        assertEq(USDC.balanceOf(grantee) - afterBond, 2 * BOND - BURN, "grantee wins the disputer's bond");
    }

    function test_fork_disputeRejectedByUma() public {
        bytes32 assertionId = _submit(1);
        uint256 assertionTime = block.timestamp;
        uint256 funderBefore = USDC.balanceOf(funder);

        vm.prank(funder);
        OO.disputeAssertion(assertionId, funder);
        _answerDispute(assertionId, assertionTime, UmaSandbox.FALSE);
        escrow.settle(grantId, 1);

        assertFalse(OO.getAssertionResult(assertionId), "UMA recorded false");
        assertEq(_status(1), uint8(GrantEscrow.MilestoneStatus.Rejected));
        assertEq(escrow.pendingWithdrawals(grantee), 0);
        assertEq(USDC.balanceOf(funder) - funderBefore, BOND - BURN, "disputer nets the grantee's bond less the burn");
        assertEq(escrow.getGrant(grantId).openClaims, 0);
    }

    function test_fork_upkeepSettlesThroughRealOracle() public {
        _submit(0);
        _submit(1);
        vm.warp(block.timestamp + LIVENESS);

        (bool needed, bytes memory data) = escrow.checkUpkeep("");
        assertTrue(needed);
        vm.prank(keeper);
        escrow.performUpkeep(data);

        assertEq(_status(0), uint8(GrantEscrow.MilestoneStatus.Approved));
        assertEq(_status(1), uint8(GrantEscrow.MilestoneStatus.Approved));
        assertEq(escrow.pendingWithdrawals(grantee), M0 + M1);
    }
}
