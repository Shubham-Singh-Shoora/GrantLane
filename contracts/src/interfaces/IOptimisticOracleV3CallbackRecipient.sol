// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IOptimisticOracleV3CallbackRecipient
/// @notice Callbacks UMA's Optimistic Oracle V3 makes to an assertion's callbackRecipient.
/// @dev Matches UMA's OptimisticOracleV3CallbackRecipientInterface. The oracle calls
///      these inside settleAssertion / disputeAssertion, so a revert here reverts the
///      oracle's own transaction — implementations must not revert on legitimate input.
interface IOptimisticOracleV3CallbackRecipient {
    function assertionResolvedCallback(bytes32 assertionId, bool assertedTruthfully) external;

    function assertionDisputedCallback(bytes32 assertionId) external;
}
