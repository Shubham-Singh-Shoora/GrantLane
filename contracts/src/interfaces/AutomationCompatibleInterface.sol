// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AutomationCompatibleInterface
/// @notice Chainlink Automation's custom-logic upkeep interface.
/// @dev Identical to @chainlink/contracts AutomationCompatibleInterface. Vendored
///      because it is two functions, and pulling the whole Chainlink contracts
///      package in for them would be most of the dependency tree for none of the code.
interface AutomationCompatibleInterface {
    /// @notice Simulated off-chain by the Automation network to decide whether to act.
    function checkUpkeep(bytes calldata checkData) external returns (bool upkeepNeeded, bytes memory performData);

    /// @notice Executed on-chain when checkUpkeep returned true.
    function performUpkeep(bytes calldata performData) external;
}
