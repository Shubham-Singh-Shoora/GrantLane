// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";
import {AutomationCompatibleInterface} from "../interfaces/AutomationCompatibleInterface.sol";

/// @title SettlementReceiver
/// @notice Lets a CRE workflow run GrantEscrow's settlement. On a cron schedule the
///         workflow reads checkUpkeep off-chain; when claims are ready it sends a
///         DON-signed report whose payload is the performData, and this contract hands
///         it to performUpkeep.
/// @dev This is Chainlink's documented path from Automation to CRE, made narrower on
///      purpose. The generic AutomationReceiver forwards arbitrary (target, data) calls;
///      this one can only call performUpkeep on one escrow. performUpkeep is
///      permissionless and re-validates every id, so even a forged report could only
///      settle what anyone may already settle — the forwarder and author checks are
///      defence in depth, not the thing keeping funds safe.
///
///      Deploy against the simulation MockKeystoneForwarder, then point it at the
///      production KeystoneForwarder with setForwarderAddress once the workflow is
///      deployed to a DON.
contract SettlementReceiver is ReceiverTemplate {
    AutomationCompatibleInterface public immutable escrow;

    event SettlementRelayed(uint256 claims);

    constructor(address forwarderAddress, AutomationCompatibleInterface escrow_) ReceiverTemplate(forwarderAddress) {
        if (address(escrow_) == address(0)) revert ZeroAddress();
        escrow = escrow_;
    }

    /// @dev The report is GrantEscrow's own performData — abi.encode(bytes32[]) — passed
    ///      through unchanged.
    function _processReport(bytes calldata report) internal override {
        uint256 claims = abi.decode(report, (bytes32[])).length;
        escrow.performUpkeep(report);
        emit SettlementRelayed(claims);
    }
}
