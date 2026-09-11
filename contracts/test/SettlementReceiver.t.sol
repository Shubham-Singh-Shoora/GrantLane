// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SettlementReceiver} from "../src/automation/SettlementReceiver.sol";
import {ReceiverTemplate} from "../src/automation/ReceiverTemplate.sol";
import {IReceiver} from "../src/automation/IReceiver.sol";
import {AutomationCompatibleInterface} from "../src/interfaces/AutomationCompatibleInterface.sol";

/// @dev Records what the receiver hands it. The real escrow path is covered by the fork tests.
contract RecordingEscrow is AutomationCompatibleInterface {
    bytes public lastPerformData;
    uint256 public calls;

    function checkUpkeep(bytes calldata) external pure returns (bool, bytes memory) {
        return (false, "");
    }

    function performUpkeep(bytes calldata performData) external {
        lastPerformData = performData;
        ++calls;
    }
}

contract SettlementReceiverTest is Test {
    SettlementReceiver internal receiver;
    RecordingEscrow internal escrow;

    address internal forwarder = makeAddr("forwarder");
    address internal workflowOwner = makeAddr("workflowOwner");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        escrow = new RecordingEscrow();
        receiver = new SettlementReceiver(forwarder, escrow);
    }

    /// @dev Keystone metadata: cid(32) | workflow_name(10) | workflow_owner(20) | report_name(2)
    function _metadata(address owner) internal pure returns (bytes memory) {
        return abi.encodePacked(bytes32(uint256(1)), bytes10("settlement"), bytes20(owner), bytes2(0x0001));
    }

    function _report() internal pure returns (bytes memory) {
        bytes32[] memory ids = new bytes32[](2);
        ids[0] = keccak256("claim-a");
        ids[1] = keccak256("claim-b");
        return abi.encode(ids);
    }

    function test_onReport_passesPerformDataThroughUnchanged() public {
        bytes memory report = _report();

        vm.expectEmit(address(receiver));
        emit SettlementReceiver.SettlementRelayed(2);
        vm.prank(forwarder);
        receiver.onReport(_metadata(workflowOwner), report);

        assertEq(escrow.calls(), 1);
        assertEq(escrow.lastPerformData(), report);
    }

    function test_onReport_onlyForwarder() public {
        bytes memory metadata = _metadata(workflowOwner);
        bytes memory report = _report();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidForwarder.selector, stranger, forwarder));
        receiver.onReport(metadata, report);
    }

    function test_onReport_enforcesWorkflowOwnerWhenSet() public {
        receiver.setExpectedAuthor(workflowOwner);
        bytes memory report = _report();
        bytes memory impostor = _metadata(stranger);

        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidAuthor.selector, stranger, workflowOwner));
        receiver.onReport(impostor, report);

        vm.prank(forwarder);
        receiver.onReport(_metadata(workflowOwner), report);
        assertEq(escrow.calls(), 1);
    }

    function test_onReport_rejectsMalformedReport() public {
        bytes memory metadata = _metadata(workflowOwner);
        vm.prank(forwarder);
        vm.expectRevert();
        receiver.onReport(metadata, hex"deadbeef");
        assertEq(escrow.calls(), 0);
    }

    /// @dev Moving from simulation to a deployed workflow swaps the forwarder.
    function test_setForwarderAddress_switchesToProduction() public {
        address production = makeAddr("productionForwarder");
        receiver.setForwarderAddress(production);

        bytes memory metadata = _metadata(workflowOwner);
        bytes memory report = _report();
        vm.prank(forwarder);
        vm.expectRevert(abi.encodeWithSelector(ReceiverTemplate.InvalidForwarder.selector, forwarder, production));
        receiver.onReport(metadata, report);

        vm.prank(production);
        receiver.onReport(metadata, report);
        assertEq(escrow.calls(), 1);
    }

    function test_setForwarderAddress_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        receiver.setForwarderAddress(stranger);
    }

    function test_constructor_rejectsZeroEscrow() public {
        vm.expectRevert(ReceiverTemplate.ZeroAddress.selector);
        new SettlementReceiver(forwarder, AutomationCompatibleInterface(address(0)));
    }

    function test_supportsInterface() public view {
        assertTrue(receiver.supportsInterface(type(IReceiver).interfaceId));
    }
}
