// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GrantEscrow} from "../src/GrantEscrow.sol";
import {ReceiverTemplate} from "../src/ReceiverTemplate.sol";
import {IReceiver} from "../src/interfaces/IReceiver.sol";

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
    MockUSDC internal usdc;

    address internal forwarder = makeAddr("forwarder");
    address internal funder = makeAddr("funder");
    address internal grantee = makeAddr("grantee");
    address internal stranger = makeAddr("stranger");

    uint256 internal attestorKey = 0xA11CE;
    address internal attestor;

    bytes32 private constant PAYOUT_WALLET_TYPEHASH = keccak256(
        "PayoutWalletChange(uint256 grantId,address newWallet,bytes32 nullifierHash,uint256 nonce,uint256 deadline)"
    );

    uint128 constant M0 = 600e6;
    uint128 constant M1 = 400e6;

    function setUp() public {
        attestor = vm.addr(attestorKey);
        usdc = new MockUSDC();
        escrow = new GrantEscrow(forwarder, attestor);

        usdc.mint(funder, 10_000e6);
        vm.prank(funder);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    function _createGrant() internal returns (uint256 grantId) {
        uint128[] memory amounts = new uint128[](2);
        amounts[0] = M0;
        amounts[1] = M1;
        vm.prank(funder);
        grantId = escrow.createGrant(grantee, IERC20(address(usdc)), amounts);
    }

    /// @dev Keystone metadata layout after the length prefix:
    ///      cid(32) | workflow_name(10) | workflow_owner(20) | report_name(2)
    function _metadata(bytes10 name, address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(1)), name, bytes20(owner), bytes2(0x0001));
    }

    function _report(uint256 grantId, uint256 milestoneId, bool approved, uint128 payout, uint16 scoreBps)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(grantId, milestoneId, approved, payout, scoreBps);
    }

    function _deliver(bytes memory report) internal {
        vm.prank(forwarder);
        escrow.onReport(_metadata(bytes10("grantlane"), address(0xBEEF)), report);
    }

    function _signPayoutChange(uint256 grantId, address newWallet, bytes32 nullifier, uint256 nonce, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash =
            keccak256(abi.encode(PAYOUT_WALLET_TYPEHASH, grantId, newWallet, nullifier, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attestorKey, digest);
        return abi.encodePacked(r, s, v);
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
        assertTrue(g.active);
    }

    function test_createGrant_revertsOnEmptyMilestones() public {
        uint128[] memory amounts = new uint128[](0);
        vm.prank(funder);
        vm.expectRevert(GrantEscrow.EmptyMilestones.selector);
        escrow.createGrant(grantee, IERC20(address(usdc)), amounts);
    }

    function test_submitEvidence_onlyGrantee() public {
        uint256 grantId = _createGrant();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NotGrantee.selector, stranger));
        escrow.submitEvidence(grantId, 0, keccak256("evidence"));
    }

    function test_submitEvidence_marksSubmitted() public {
        uint256 grantId = _createGrant();
        vm.prank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("evidence"));

        GrantEscrow.Milestone[] memory ms = escrow.getMilestones(grantId);
        assertEq(uint8(ms[0].status), uint8(GrantEscrow.MilestoneStatus.Submitted));
        assertEq(ms[0].evidenceHash, keccak256("evidence"));
    }

    // ------------------------------------------------------------------
    // report handling
    // ------------------------------------------------------------------

    function test_onReport_revertsFromNonForwarder() public {
        uint256 grantId = _createGrant();
        vm.prank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("evidence"));

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidForwarder.selector, stranger, forwarder));
        escrow.onReport(_metadata(bytes10("grantlane"), address(0xBEEF)), _report(grantId, 0, true, M0, 9000));
    }

    function test_onReport_approvesAndPaysGrantee() public {
        uint256 grantId = _createGrant();
        vm.prank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("evidence"));

        _deliver(_report(grantId, 0, true, M0, 9000));

        assertEq(usdc.balanceOf(grantee), M0, "grantee paid");
        assertEq(usdc.balanceOf(address(escrow)), M1, "remainder still escrowed");

        GrantEscrow.Milestone[] memory ms = escrow.getMilestones(grantId);
        assertEq(uint8(ms[0].status), uint8(GrantEscrow.MilestoneStatus.Paid));
        assertEq(ms[0].scoreBps, 9000);
        assertEq(ms[0].paidAmount, M0);
        assertEq(escrow.getGrant(grantId).releasedAmount, M0);
    }

    function test_onReport_rejectionPaysNothing() public {
        uint256 grantId = _createGrant();
        vm.prank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("evidence"));

        _deliver(_report(grantId, 0, false, 0, 2500));

        assertEq(usdc.balanceOf(grantee), 0, "no payout on rejection");
        GrantEscrow.Milestone[] memory ms = escrow.getMilestones(grantId);
        assertEq(uint8(ms[0].status), uint8(GrantEscrow.MilestoneStatus.Rejected));
        assertEq(ms[0].scoreBps, 2500);
    }

    function test_onReport_rejectedMilestoneCanBeResubmitted() public {
        uint256 grantId = _createGrant();
        vm.startPrank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("v1"));
        vm.stopPrank();

        _deliver(_report(grantId, 0, false, 0, 1000));

        vm.prank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("v2"));
        _deliver(_report(grantId, 0, true, M0, 9500));

        assertEq(usdc.balanceOf(grantee), M0, "paid after resubmission");
    }

    function test_onReport_revertsWhenMilestoneNotSubmitted() public {
        uint256 grantId = _createGrant();
        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(GrantEscrow.MilestoneNotSubmitted.selector, GrantEscrow.MilestoneStatus.Pending)
        );
        escrow.onReport(_metadata(bytes10("grantlane"), address(0xBEEF)), _report(grantId, 0, true, M0, 9000));
    }

    function test_onReport_revertsWhenPayoutExceedsMilestone() public {
        uint256 grantId = _createGrant();
        vm.prank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("evidence"));

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.PayoutExceedsMilestone.selector, M0 + 1, M0));
        escrow.onReport(_metadata(bytes10("grantlane"), address(0xBEEF)), _report(grantId, 0, true, M0 + 1, 9000));
    }

    function test_onReport_enforcesExpectedAuthorWhenSet() public {
        escrow.setExpectedAuthor(address(0xBEEF));

        uint256 grantId = _createGrant();
        vm.prank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("evidence"));

        vm.prank(forwarder);
        vm.expectRevert(
            abi.encodeWithSelector(ReceiverTemplate.InvalidAuthor.selector, address(0xDEAD), address(0xBEEF))
        );
        escrow.onReport(_metadata(bytes10("grantlane"), address(0xDEAD)), _report(grantId, 0, true, M0, 9000));

        // the expected author still gets through
        _deliver(_report(grantId, 0, true, M0, 9000));
        assertEq(usdc.balanceOf(grantee), M0);
    }

    function test_supportsInterface() public view {
        assertTrue(escrow.supportsInterface(type(IReceiver).interfaceId));
    }

    // ------------------------------------------------------------------
    // Selfie-Check-gated payout wallet change
    // ------------------------------------------------------------------

    function test_changePayoutWallet_withValidAttestation() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");
        bytes32 nullifier = keccak256("nullifier-1");
        uint256 deadline = block.timestamp + 10 minutes;

        bytes memory sig = _signPayoutChange(grantId, newWallet, nullifier, 0, deadline);
        vm.prank(grantee);
        escrow.changePayoutWallet(grantId, newWallet, nullifier, deadline, sig);

        assertEq(escrow.getGrant(grantId).payoutWallet, newWallet);
        assertEq(escrow.payoutWalletNonce(grantId), 1);
        assertTrue(escrow.usedNullifier(nullifier));
    }

    function test_changePayoutWallet_redirectsPayout() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");
        bytes32 nullifier = keccak256("nullifier-1");
        uint256 deadline = block.timestamp + 10 minutes;

        // Build the attestation first: signing reads escrow.domainSeparator(), and an
        // external call inside the argument list would consume the pending vm.prank.
        bytes memory sig = _signPayoutChange(grantId, newWallet, nullifier, 0, deadline);
        vm.prank(grantee);
        escrow.changePayoutWallet(grantId, newWallet, nullifier, deadline, sig);

        vm.prank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("evidence"));
        _deliver(_report(grantId, 0, true, M0, 9000));

        assertEq(usdc.balanceOf(newWallet), M0, "paid to new wallet");
        assertEq(usdc.balanceOf(grantee), 0, "old wallet unpaid");
    }

    function test_changePayoutWallet_rejectsReplayedNullifier() public {
        uint256 grantId = _createGrant();
        address w1 = makeAddr("w1");
        address w2 = makeAddr("w2");
        bytes32 nullifier = keccak256("nullifier-1");
        uint256 deadline = block.timestamp + 10 minutes;

        bytes memory sig1 = _signPayoutChange(grantId, w1, nullifier, 0, deadline);
        vm.prank(grantee);
        escrow.changePayoutWallet(grantId, w1, nullifier, deadline, sig1);

        // same Selfie Check proof, second attempt
        bytes memory sig2 = _signPayoutChange(grantId, w2, nullifier, 1, deadline);
        vm.prank(grantee);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NullifierAlreadyUsed.selector, nullifier));
        escrow.changePayoutWallet(grantId, w2, nullifier, deadline, sig2);
    }

    function test_changePayoutWallet_rejectsForgedAttestation() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");
        bytes32 nullifier = keccak256("nullifier-1");
        uint256 deadline = block.timestamp + 10 minutes;

        uint256 wrongKey = 0xBAD;
        bytes32 structHash =
            keccak256(abi.encode(PAYOUT_WALLET_TYPEHASH, grantId, newWallet, nullifier, uint256(0), deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);

        vm.prank(grantee);
        vm.expectRevert(
            abi.encodeWithSelector(GrantEscrow.BadAttestation.selector, vm.addr(wrongKey), attestor)
        );
        escrow.changePayoutWallet(grantId, newWallet, nullifier, deadline, abi.encodePacked(r, s, v));
    }

    function test_changePayoutWallet_rejectsExpiredAttestation() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");
        bytes32 nullifier = keccak256("nullifier-1");
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _signPayoutChange(grantId, newWallet, nullifier, 0, deadline);

        vm.warp(deadline + 1);
        vm.prank(grantee);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.AttestationExpired.selector, deadline));
        escrow.changePayoutWallet(grantId, newWallet, nullifier, deadline, sig);
    }

    function test_changePayoutWallet_onlyGrantee() public {
        uint256 grantId = _createGrant();
        address newWallet = makeAddr("newWallet");
        bytes32 nullifier = keccak256("nullifier-1");
        uint256 deadline = block.timestamp + 10 minutes;
        bytes memory sig = _signPayoutChange(grantId, newWallet, nullifier, 0, deadline);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NotGrantee.selector, stranger));
        escrow.changePayoutWallet(grantId, newWallet, nullifier, deadline, sig);
    }

    // ------------------------------------------------------------------
    // funder exit
    // ------------------------------------------------------------------

    function test_closeGrant_refundsUnreleased() public {
        uint256 grantId = _createGrant();
        vm.prank(grantee);
        escrow.submitEvidence(grantId, 0, keccak256("evidence"));
        _deliver(_report(grantId, 0, true, M0, 9000));

        uint256 before = usdc.balanceOf(funder);
        vm.prank(funder);
        escrow.closeGrant(grantId);

        assertEq(usdc.balanceOf(funder) - before, M1, "unreleased refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained");
    }

    function test_closeGrant_onlyFunder() public {
        uint256 grantId = _createGrant();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GrantEscrow.NotFunder.selector, stranger));
        escrow.closeGrant(grantId);
    }
}
