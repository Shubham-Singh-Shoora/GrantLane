// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {GrantEscrow} from "../src/GrantEscrow.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";
import {MockOptimisticOracleV3} from "./mocks/MockOptimisticOracleV3.sol";

/// @dev 6-decimal stand-in for USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract GrantEscrowTest is Test {
    GrantEscrow internal escrow;
    MockOptimisticOracleV3 internal oracle;
    MockUSDC internal usdc;

    address internal funder = makeAddr("funder");
    address internal grantee = makeAddr("grantee");
    address internal stranger = makeAddr("stranger");
    address internal keeper = makeAddr("keeper");

    uint256 internal attestorKey = 0xA11CE;
    address internal attestor;

    bytes32 private constant PAYOUT_WALLET_TYPEHASH = keccak256(
        "PayoutWalletChange(uint256 grantId,address newWallet,bytes32 nullifierHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant MILESTONE_CLAIM_TYPEHASH = keccak256(
        "MilestoneClaim(uint256 grantId,uint256 milestoneId,bytes32 evidenceHash,bytes32 nullifierHash,uint256 nonce,uint256 deadline)"
    );

    uint128 constant M0 = 600e6;
    uint128 constant M1 = 400e6;
    uint64 constant LIVENESS = 300;
    uint256 constant BOND = 1e6;
    uint256 constant BURN = BOND / 2;

    bytes32 constant TERMS = keccak256("terms: ship the SDK, then the docs");
    string constant EVIDENCE_URI = "https://grantlane.app/evidence/0/0";
    bytes32 constant EVIDENCE = keccak256("evidence bundle");
    bytes32 constant CLAIM_NULLIFIER = keccak256("grantee-milestone-nullifier");

    function setUp() public {
        attestor = vm.addr(attestorKey);
        usdc = new MockUSDC();
        oracle = new MockOptimisticOracleV3(0);
        escrow = new GrantEscrow(IOptimisticOracleV3(address(oracle)), IERC20(address(usdc)), attestor, LIVENESS, BOND);

        usdc.mint(funder, 10_000e6);
        usdc.mint(grantee, 100e6);
        usdc.mint(stranger, 100e6);

        vm.startPrank(funder);
        usdc.approve(address(escrow), type(uint256).max);
        usdc.approve(address(oracle), type(uint256).max); // dispute bonds
        vm.stopPrank();

        vm.prank(grantee);
        usdc.approve(address(escrow), type(uint256).max); // claim bonds

        vm.prank(stranger);
        usdc.approve(address(oracle), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _createGrant() internal returns (uint256 grantId) {
        uint128[] memory amounts = new uint128[](2);
        amounts[0] = M0;
        amounts[1] = M1;
        vm.prank(funder);
        grantId = escrow.createGrant(grantee, amounts, TERMS);
    }

    function _sign(uint256 key, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _claimAttestation(uint256 grantId, uint256 milestoneId, bytes32 evidenceHash, uint256 nonce, uint256 key)
        internal
        view
        returns (GrantEscrow.SelfieAttestation memory)
    {
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 structHash = keccak256(
            abi.encode(MILESTONE_CLAIM_TYPEHASH, grantId, milestoneId, evidenceHash, CLAIM_NULLIFIER, nonce, deadline)
        );
        return GrantEscrow.SelfieAttestation(CLAIM_NULLIFIER, deadline, _sign(key, structHash));
    }

    function _payoutAttestation(uint256 grantId, address newWallet, bytes32 nullifier, uint256 nonce, uint256 key)
        internal
        view
        returns (GrantEscrow.SelfieAttestation memory)
    {
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 structHash =
            keccak256(abi.encode(PAYOUT_WALLET_TYPEHASH, grantId, newWallet, nullifier, nonce, deadline));
        return GrantEscrow.SelfieAttestation(nullifier, deadline, _sign(key, structHash));
    }

    /// @dev Attestations are built before vm.prank: they read the escrow, and an external
    ///      call made after the prank would consume it.
    function _submit(uint256 grantId, uint256 milestoneId) internal returns (bytes32) {
        GrantEscrow.SelfieAttestation memory selfie =
            _claimAttestation(grantId, milestoneId, EVIDENCE, escrow.claimNonce(grantId), attestorKey);
        vm.prank(grantee);
        return escrow.submitMilestone(grantId, milestoneId, EVIDENCE_URI, EVIDENCE, selfie);
    }

    function _dispute(bytes32 assertionId) internal {
        vm.prank(funder);
        oracle.disputeAssertion(assertionId, funder);
    }

    function _status(uint256 grantId, uint256 milestoneId) internal view returns (GrantEscrow.MilestoneStatus) {
        return escrow.getMilestones(grantId)[milestoneId].status;
    }

    function _assertStatus(uint256 grantId, uint256 milestoneId, GrantEscrow.MilestoneStatus expected) internal view {
        assertEq(uint8(_status(grantId, milestoneId)), uint8(expected), "milestone status");
    }

    // ------------------------------------------------------------------
    // deployment
    // ------------------------------------------------------------------

    function test_constructor_readsOracleDefaults() public view {
        assertEq(address(escrow.oracle()), address(oracle));
        assertEq(address(escrow.usdc()), address(usdc));
        assertEq(escrow.bond(), BOND);
        assertEq(escrow.liveness(), LIVENESS);
        assertEq(escrow.identifier(), bytes32("ASSERT_TRUTH"));
        assertEq(escrow.owner(), address(this));
    }

    function test_constructor_rejectsBondBelowOracleMinimum() public {
        MockOptimisticOracleV3 strict = new MockOptimisticOracleV3(5e6);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.BondBelowMinimum.selector, BOND, 5e6));
        new GrantEscrow(IOptimisticOracleV3(address(strict)), IERC20(address(usdc)), attestor, LIVENESS, BOND);
    }

    function test_constructor_rejectsZeroBond() public {
        vm.expectRevert(GrantEscrow.BondZero.selector);
        new GrantEscrow(IOptimisticOracleV3(address(oracle)), IERC20(address(usdc)), attestor, LIVENESS, 0);
    }

    // ------------------------------------------------------------------
    // funding
    // ------------------------------------------------------------------

    function test_createGrant_escrowsTotal() public {
        uint256 grantId = _createGrant();

        assertEq(usdc.balanceOf(address(escrow)), M0 + M1, "escrow funded");
        assertEq(escrow.milestoneCount(grantId), 2, "milestone count");

        GrantEscrow.Grant memory g = escrow.getGrant(grantId);
        assertEq(g.funder, funder);
        assertEq(g.grantee, grantee);
        assertEq(g.payoutWallet, grantee, "payout defaults to grantee");
        assertEq(g.totalAmount, M0 + M1);
        assertEq(g.releasedAmount, 0);
        assertEq(g.openClaims, 0);
        assertEq(g.termsHash, TERMS);
        assertTrue(g.active);
        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Pending);
    }

    function test_createGrant_revertsOnEmptyMilestones() public {
        uint128[] memory amounts = new uint128[](0);
        vm.prank(funder);
        vm.expectRevert(GrantEscrow.EmptyMilestones.selector);
        escrow.createGrant(grantee, amounts, TERMS);
    }

    function test_createGrant_revertsOnZeroAmount() public {
        uint128[] memory amounts = new uint128[](2);
        amounts[0] = M0;
        vm.prank(funder);
        vm.expectRevert(GrantEscrow.AmountZero.selector);
        escrow.createGrant(grantee, amounts, TERMS);
    }

    function test_createGrant_requiresTermsCommitment() public {
        uint128[] memory amounts = new uint128[](1);
        amounts[0] = M0;
        vm.prank(funder);
        vm.expectRevert(GrantEscrow.EmptyTerms.selector);
        escrow.createGrant(grantee, amounts, bytes32(0));
    }

    // ------------------------------------------------------------------
    // claiming a milestone
    // ------------------------------------------------------------------

    function test_submitMilestone_assertsOnUmaWithGranteeBond() public {
        uint256 grantId = _createGrant();
        uint256 granteeBefore = usdc.balanceOf(grantee);

        bytes32 assertionId = _submit(grantId, 0);

        MockOptimisticOracleV3.Assertion memory a = oracle.getAssertion(assertionId);
        assertEq(a.asserter, grantee, "grantee is the asserter");
        assertEq(a.callbackRecipient, address(escrow), "escrow receives callbacks");
        assertEq(address(a.currency), address(usdc), "bond in USDC");
        assertEq(a.bond, BOND);
        assertEq(a.liveness, LIVENESS);
        assertEq(a.identifier, bytes32("ASSERT_TRUTH"));

        assertEq(granteeBefore - usdc.balanceOf(grantee), BOND, "bond taken from grantee");
        assertEq(usdc.balanceOf(address(oracle)), BOND, "bond held by the oracle");
        assertEq(usdc.balanceOf(address(escrow)), M0 + M1, "escrow keeps only grant funds");
        assertEq(usdc.allowance(address(escrow), address(oracle)), 0, "no leftover allowance");

        GrantEscrow.Milestone memory m = escrow.getMilestones(grantId)[0];
        assertEq(uint8(m.status), uint8(GrantEscrow.MilestoneStatus.Asserted));
        assertEq(m.assertionId, assertionId);
        assertEq(m.evidenceHash, EVIDENCE);
        assertEq(m.expiresAt, block.timestamp + LIVENESS);
        assertEq(escrow.getGrant(grantId).openClaims, 1);
        assertEq(escrow.claimNonce(grantId), 1);
        assertEq(escrow.awaitingSettlement().length, 1);
    }

    function test_submitMilestone_claimTextStandsOnItsOwn() public {
        uint256 grantId = _createGrant();
        bytes32 assertionId = _submit(grantId, 1);

        bytes memory expected = bytes(
            string.concat(
                "GrantLane milestone claim. The grantee of grant 0 asserts that milestone index 1 has been ",
                "delivered as specified in the grant terms committed on-chain as ",
                Strings.toHexString(uint256(TERMS), 32),
                ". Evidence: ",
                EVIDENCE_URI,
                " (evidence hash ",
                Strings.toHexString(uint256(EVIDENCE), 32),
                "). If true, escrow ",
                Strings.toHexString(address(escrow)),
                " on chain 31337 releases 400000000 USDC base units (6 decimals) to the grantee."
            )
        );
        assertEq(oracle.getAssertion(assertionId).claim, expected);
    }

    function test_submitMilestone_onlyGrantee() public {
        uint256 grantId = _createGrant();
        GrantEscrow.SelfieAttestation memory selfie = _claimAttestation(grantId, 0, EVIDENCE, 0, attestorKey);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NotGrantee.selector, stranger));
        escrow.submitMilestone(grantId, 0, EVIDENCE_URI, EVIDENCE, selfie);
    }

    function test_submitMilestone_requiresRealSelfieAttestation() public {
        uint256 grantId = _createGrant();
        uint256 wrongKey = 0xBAD;
        GrantEscrow.SelfieAttestation memory selfie = _claimAttestation(grantId, 0, EVIDENCE, 0, wrongKey);
        vm.prank(grantee);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.BadAttestation.selector, vm.addr(wrongKey), attestor));
        escrow.submitMilestone(grantId, 0, EVIDENCE_URI, EVIDENCE, selfie);
    }

    function test_submitMilestone_attestationIsBoundToEvidence() public {
        uint256 grantId = _createGrant();
        GrantEscrow.SelfieAttestation memory selfie = _claimAttestation(grantId, 0, EVIDENCE, 0, attestorKey);
        vm.prank(grantee);
        vm.expectPartialRevert(GrantEscrow.BadAttestation.selector);
        escrow.submitMilestone(grantId, 0, EVIDENCE_URI, keccak256("different evidence"), selfie);
    }

    function test_submitMilestone_rejectsExpiredAttestation() public {
        uint256 grantId = _createGrant();
        GrantEscrow.SelfieAttestation memory selfie = _claimAttestation(grantId, 0, EVIDENCE, 0, attestorKey);
        vm.warp(selfie.deadline + 1);
        vm.prank(grantee);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.AttestationExpired.selector, selfie.deadline));
        escrow.submitMilestone(grantId, 0, EVIDENCE_URI, EVIDENCE, selfie);
    }

    function test_submitMilestone_attestationCannotBeReplayed() public {
        uint256 grantId = _createGrant();
        GrantEscrow.SelfieAttestation memory selfie = _claimAttestation(grantId, 0, EVIDENCE, 0, attestorKey);
        vm.prank(grantee);
        bytes32 assertionId = escrow.submitMilestone(grantId, 0, EVIDENCE_URI, EVIDENCE, selfie);

        // Claim rejected, milestone reopens — the old attestation must not work again.
        _dispute(assertionId);
        oracle.resolveDispute(assertionId, false);
        escrow.settle(grantId, 0);

        vm.prank(grantee);
        vm.expectPartialRevert(GrantEscrow.BadAttestation.selector);
        escrow.submitMilestone(grantId, 0, EVIDENCE_URI, EVIDENCE, selfie);
    }

    function test_submitMilestone_revertsWhileUnderReview() public {
        uint256 grantId = _createGrant();
        _submit(grantId, 0);

        GrantEscrow.SelfieAttestation memory selfie = _claimAttestation(grantId, 0, EVIDENCE, 1, attestorKey);
        vm.prank(grantee);
        vm.expectRevert(
            abi.encodeWithSelector(GrantEscrow.MilestoneNotOpen.selector, GrantEscrow.MilestoneStatus.Asserted)
        );
        escrow.submitMilestone(grantId, 0, EVIDENCE_URI, EVIDENCE, selfie);
    }

    function test_submitMilestone_requiresEvidence() public {
        uint256 grantId = _createGrant();
        GrantEscrow.SelfieAttestation memory selfie = _claimAttestation(grantId, 0, EVIDENCE, 0, attestorKey);
        vm.prank(grantee);
        vm.expectRevert(GrantEscrow.EmptyEvidence.selector);
        escrow.submitMilestone(grantId, 0, "", EVIDENCE, selfie);
    }

    // ------------------------------------------------------------------
    // undisputed path
    // ------------------------------------------------------------------

    function test_settle_undisputedCreditsPayoutWalletAndReturnsBond() public {
        uint256 grantId = _createGrant();
        bytes32 assertionId = _submit(grantId, 0);
        uint256 granteeBefore = usdc.balanceOf(grantee);

        vm.warp(block.timestamp + LIVENESS);
        vm.prank(stranger); // anyone can settle
        escrow.settle(grantId, 0);

        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Approved);
        assertEq(escrow.pendingWithdrawals(grantee), M0, "credited");
        assertEq(usdc.balanceOf(grantee) - granteeBefore, BOND, "bond returned");
        assertEq(escrow.getGrant(grantId).releasedAmount, M0);
        assertEq(escrow.getGrant(grantId).openClaims, 0);
        assertEq(escrow.awaitingSettlement().length, 0);
        assertTrue(oracle.getAssertionResult(assertionId));
    }

    function test_settle_revertsBeforeLivenessEnds() public {
        uint256 grantId = _createGrant();
        _submit(grantId, 0);
        uint64 expiresAt = escrow.getMilestones(grantId)[0].expiresAt;

        vm.warp(expiresAt - 1);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.LivenessNotOver.selector, expiresAt));
        escrow.settle(grantId, 0);
    }

    function test_settle_revertsWhenNothingToSettle() public {
        uint256 grantId = _createGrant();
        vm.expectRevert(
            abi.encodeWithSelector(GrantEscrow.MilestoneNotUnderReview.selector, GrantEscrow.MilestoneStatus.Pending)
        );
        escrow.settle(grantId, 0);
    }

    function test_settle_directlyOnOracleStillPays() public {
        uint256 grantId = _createGrant();
        bytes32 assertionId = _submit(grantId, 0);

        vm.warp(block.timestamp + LIVENESS);
        vm.prank(stranger);
        oracle.settleAssertion(assertionId); // bypasses the escrow's settle()

        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Approved);
        assertEq(escrow.pendingWithdrawals(grantee), M0);
    }

    function test_withdraw_paysOutCredit() public {
        uint256 grantId = _createGrant();
        _submit(grantId, 0);
        vm.warp(block.timestamp + LIVENESS);
        escrow.settle(grantId, 0);

        uint256 before = usdc.balanceOf(grantee);
        vm.prank(grantee);
        uint256 amount = escrow.withdraw();

        assertEq(amount, M0);
        assertEq(usdc.balanceOf(grantee) - before, M0, "paid");
        assertEq(escrow.pendingWithdrawals(grantee), 0, "credit cleared");
        assertEq(usdc.balanceOf(address(escrow)), M1, "rest still escrowed");
    }

    function test_withdraw_revertsWhenNothingOwed() public {
        vm.prank(grantee);
        vm.expectRevert(GrantEscrow.NothingToWithdraw.selector);
        escrow.withdraw();
    }

    // ------------------------------------------------------------------
    // disputes
    // ------------------------------------------------------------------

    function test_dispute_marksDisputedAndStopsAutoSettle() public {
        uint256 grantId = _createGrant();
        bytes32 assertionId = _submit(grantId, 0);

        _dispute(assertionId);

        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Disputed);
        assertEq(escrow.awaitingSettlement().length, 0, "automation no longer watches it");
        assertEq(escrow.getGrant(grantId).openClaims, 1, "still open until UMA answers");

        vm.warp(block.timestamp + LIVENESS);
        (bool needed,) = escrow.checkUpkeep("");
        assertFalse(needed, "a disputed claim waits for UMA, not the clock");
    }

    function test_dispute_upheldClaimPaysGranteeAndTheDisputersBond() public {
        uint256 grantId = _createGrant();
        bytes32 assertionId = _submit(grantId, 0);
        uint256 granteeBefore = usdc.balanceOf(grantee);
        uint256 funderBefore = usdc.balanceOf(funder);

        _dispute(assertionId);
        oracle.resolveDispute(assertionId, true);
        escrow.settle(grantId, 0);

        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Approved);
        assertEq(escrow.pendingWithdrawals(grantee), M0, "milestone credited");
        assertEq(usdc.balanceOf(grantee) - granteeBefore, 2 * BOND - BURN, "bond back plus reward");
        assertEq(funderBefore - usdc.balanceOf(funder), BOND, "wrong disputer loses bond");
        assertEq(escrow.getGrant(grantId).openClaims, 0);
    }

    function test_dispute_falseClaimRejectsAndDisputerWinsBond() public {
        uint256 grantId = _createGrant();
        bytes32 assertionId = _submit(grantId, 0);
        uint256 granteeBefore = usdc.balanceOf(grantee);
        uint256 funderBefore = usdc.balanceOf(funder);

        _dispute(assertionId);
        oracle.resolveDispute(assertionId, false);
        escrow.settle(grantId, 0);

        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Rejected);
        assertEq(escrow.pendingWithdrawals(grantee), 0, "nothing credited");
        assertEq(usdc.balanceOf(grantee), granteeBefore, "grantee's bond is gone");
        assertEq(usdc.balanceOf(funder) - funderBefore, BOND - BURN, "disputer rewarded");
        assertEq(escrow.getGrant(grantId).releasedAmount, 0);
        assertEq(escrow.getGrant(grantId).openClaims, 0);
        assertEq(usdc.balanceOf(address(escrow)), M0 + M1, "grant funds untouched");
    }

    function test_dispute_rejectedMilestoneCanBeClaimedAgain() public {
        uint256 grantId = _createGrant();
        bytes32 first = _submit(grantId, 0);
        _dispute(first);
        oracle.resolveDispute(first, false);
        escrow.settle(grantId, 0);

        bytes32 second = _submit(grantId, 0);
        assertTrue(second != first, "fresh assertion");
        vm.warp(block.timestamp + LIVENESS);
        escrow.settle(grantId, 0);

        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Approved);
        assertEq(escrow.pendingWithdrawals(grantee), M0);
    }

    // ------------------------------------------------------------------
    // callbacks
    // ------------------------------------------------------------------

    function test_resolvedCallback_onlyOracle() public {
        uint256 grantId = _createGrant();
        bytes32 assertionId = _submit(grantId, 0);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NotOracle.selector, stranger));
        escrow.assertionResolvedCallback(assertionId, true);
    }

    function test_disputedCallback_onlyOracle() public {
        uint256 grantId = _createGrant();
        bytes32 assertionId = _submit(grantId, 0);

        vm.prank(grantee);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NotOracle.selector, grantee));
        escrow.assertionDisputedCallback(assertionId);
    }

    /// @dev Anyone can name the escrow as a callback recipient. Their assertion must still
    ///      settle, and must not touch any grant.
    function test_foreignAssertionsAreIgnored() public {
        uint256 grantId = _createGrant();
        bytes32 identifier = oracle.defaultIdentifier();

        vm.prank(stranger);
        bytes32 foreign = oracle.assertTruth(
            "pay me", stranger, address(escrow), address(0), LIVENESS, IERC20(address(usdc)), BOND, identifier, 0
        );
        _dispute(foreign);
        oracle.resolveDispute(foreign, true);
        oracle.settleAssertion(foreign);

        assertEq(escrow.pendingWithdrawals(stranger), 0);
        assertEq(escrow.getGrant(grantId).releasedAmount, 0);
        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Pending);
    }

    // ------------------------------------------------------------------
    // funder exit
    // ------------------------------------------------------------------

    function test_closeGrant_blockedWhileClaimIsLive() public {
        uint256 grantId = _createGrant();
        _submit(grantId, 0);

        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.ClaimsOpen.selector, uint32(1)));
        escrow.closeGrant(grantId);
    }

    function test_closeGrant_blockedWhileDisputed() public {
        uint256 grantId = _createGrant();
        _dispute(_submit(grantId, 0));

        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.ClaimsOpen.selector, uint32(1)));
        escrow.closeGrant(grantId);
    }

    function test_closeGrant_refundsUnreleasedAndKeepsCredits() public {
        uint256 grantId = _createGrant();
        _submit(grantId, 0);
        vm.warp(block.timestamp + LIVENESS);
        escrow.settle(grantId, 0);

        uint256 before = usdc.balanceOf(funder);
        vm.prank(funder);
        escrow.closeGrant(grantId);
        assertEq(usdc.balanceOf(funder) - before, M1, "unreleased refunded");
        assertFalse(escrow.getGrant(grantId).active);

        // The approved milestone is still owed to the grantee.
        vm.prank(grantee);
        escrow.withdraw();
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained");
    }

    function test_closeGrant_onlyFunder() public {
        uint256 grantId = _createGrant();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NotFunder.selector, stranger));
        escrow.closeGrant(grantId);
    }

    // ------------------------------------------------------------------
    // Chainlink Automation
    // ------------------------------------------------------------------

    function test_checkUpkeep_idleBeforeLivenessEnds() public {
        uint256 grantId = _createGrant();
        _submit(grantId, 0);

        vm.warp(block.timestamp + LIVENESS - 1);
        (bool needed, bytes memory data) = escrow.checkUpkeep("");
        assertFalse(needed);
        assertEq(data.length, 0);
    }

    function test_upkeep_settlesEveryExpiredClaim() public {
        uint256 grantId = _createGrant();
        bytes32 a0 = _submit(grantId, 0);
        bytes32 a1 = _submit(grantId, 1);

        vm.warp(block.timestamp + LIVENESS);
        (bool needed, bytes memory data) = escrow.checkUpkeep("");
        assertTrue(needed);
        bytes32[] memory ids = abi.decode(data, (bytes32[]));
        assertEq(ids.length, 2);
        assertEq(ids[0], a0);
        assertEq(ids[1], a1);

        vm.prank(keeper);
        escrow.performUpkeep(data);

        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Approved);
        _assertStatus(grantId, 1, GrantEscrow.MilestoneStatus.Approved);
        assertEq(escrow.pendingWithdrawals(grantee), M0 + M1);
        (needed,) = escrow.checkUpkeep("");
        assertFalse(needed, "nothing left to do");
    }

    function test_performUpkeep_toleratesStaleData() public {
        uint256 grantId = _createGrant();
        _submit(grantId, 0);
        _submit(grantId, 1);
        vm.warp(block.timestamp + LIVENESS);
        (, bytes memory data) = escrow.checkUpkeep("");

        // Someone settles one claim by hand before the upkeep lands.
        vm.prank(stranger);
        escrow.settle(grantId, 0);

        vm.prank(keeper);
        escrow.performUpkeep(data);

        _assertStatus(grantId, 1, GrantEscrow.MilestoneStatus.Approved);
        assertEq(escrow.pendingWithdrawals(grantee), M0 + M1, "each milestone credited once");
    }

    function test_performUpkeep_oneFailedSettlementDoesNotBlockTheBatch() public {
        uint256 grantId = _createGrant();
        bytes32 a0 = _submit(grantId, 0);
        _submit(grantId, 1);
        vm.warp(block.timestamp + LIVENESS);
        (, bytes memory data) = escrow.checkUpkeep("");

        vm.mockCallRevert(
            address(oracle), abi.encodeWithSelector(IOptimisticOracleV3.settleAssertion.selector, a0), "stuck"
        );
        vm.expectEmit(address(escrow));
        emit GrantEscrow.AutoSettleFailed(a0, bytes("stuck"));
        vm.prank(keeper);
        escrow.performUpkeep(data);

        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Asserted);
        _assertStatus(grantId, 1, GrantEscrow.MilestoneStatus.Approved);

        // The stuck claim is still settleable by hand once the cause clears.
        vm.clearMockedCalls();
        escrow.settle(grantId, 0);
        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Approved);
    }

    function test_performUpkeep_ignoresUnknownAndUnexpiredIds() public {
        uint256 grantId = _createGrant();
        bytes32 live = _submit(grantId, 0);

        bytes32[] memory ids = new bytes32[](2);
        ids[0] = keccak256("made up");
        ids[1] = live; // not expired yet

        vm.prank(stranger);
        escrow.performUpkeep(abi.encode(ids));

        _assertStatus(grantId, 0, GrantEscrow.MilestoneStatus.Asserted);
        assertEq(escrow.pendingWithdrawals(grantee), 0);
    }

    // ------------------------------------------------------------------
    // Selfie-Check-gated payout wallet change
    // ------------------------------------------------------------------

    function test_changePayoutWallet_withValidAttestation() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");
        bytes32 nullifier = keccak256("nullifier-1");

        GrantEscrow.SelfieAttestation memory selfie = _payoutAttestation(grantId, newWallet, nullifier, 0, attestorKey);
        vm.prank(grantee);
        escrow.changePayoutWallet(grantId, newWallet, selfie);

        assertEq(escrow.getGrant(grantId).payoutWallet, newWallet);
        assertEq(escrow.payoutWalletNonce(grantId), 1);
        assertTrue(escrow.usedNullifier(nullifier));
    }

    function test_changePayoutWallet_redirectsLaterPayouts() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");

        GrantEscrow.SelfieAttestation memory selfie =
            _payoutAttestation(grantId, newWallet, keccak256("nullifier-1"), 0, attestorKey);
        vm.prank(grantee);
        escrow.changePayoutWallet(grantId, newWallet, selfie);

        _submit(grantId, 0);
        vm.warp(block.timestamp + LIVENESS);
        escrow.settle(grantId, 0);

        assertEq(escrow.pendingWithdrawals(newWallet), M0, "credited to new wallet");
        assertEq(escrow.pendingWithdrawals(grantee), 0, "old wallet not credited");

        vm.prank(newWallet);
        escrow.withdraw();
        assertEq(usdc.balanceOf(newWallet), M0);
    }

    function test_changePayoutWallet_rejectsReplayedNullifier() public {
        uint256 grantId = _createGrant();
        address w1 = makeAddr("w1");
        address w2 = makeAddr("w2");
        bytes32 nullifier = keccak256("nullifier-1");

        GrantEscrow.SelfieAttestation memory first = _payoutAttestation(grantId, w1, nullifier, 0, attestorKey);
        vm.prank(grantee);
        escrow.changePayoutWallet(grantId, w1, first);

        GrantEscrow.SelfieAttestation memory second = _payoutAttestation(grantId, w2, nullifier, 1, attestorKey);
        vm.prank(grantee);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NullifierAlreadyUsed.selector, nullifier));
        escrow.changePayoutWallet(grantId, w2, second);
    }

    function test_changePayoutWallet_rejectsForgedAttestation() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");
        uint256 wrongKey = 0xBAD;

        GrantEscrow.SelfieAttestation memory selfie =
            _payoutAttestation(grantId, newWallet, keccak256("nullifier-1"), 0, wrongKey);
        vm.prank(grantee);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.BadAttestation.selector, vm.addr(wrongKey), attestor));
        escrow.changePayoutWallet(grantId, newWallet, selfie);
    }

    function test_changePayoutWallet_rejectsExpiredAttestation() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");

        GrantEscrow.SelfieAttestation memory selfie =
            _payoutAttestation(grantId, newWallet, keccak256("nullifier-1"), 0, attestorKey);
        vm.warp(selfie.deadline + 1);
        vm.prank(grantee);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.AttestationExpired.selector, selfie.deadline));
        escrow.changePayoutWallet(grantId, newWallet, selfie);
    }

    function test_changePayoutWallet_onlyGrantee() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");

        GrantEscrow.SelfieAttestation memory selfie =
            _payoutAttestation(grantId, newWallet, keccak256("nullifier-1"), 0, attestorKey);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NotGrantee.selector, stranger));
        escrow.changePayoutWallet(grantId, newWallet, selfie);
    }

    function test_setAttestor_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        escrow.setAttestor(stranger);
    }
}
