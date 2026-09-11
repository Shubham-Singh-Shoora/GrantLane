// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title IReceiver - receives CRE / Keystone reports.
/// @notice Implementations must advertise support for this interface through ERC165.
/// @dev Interface shape mirrors `@chainlink/contracts/src/v0.8/keystone/interfaces/IReceiver.sol`.
interface IReceiver is IERC165 {
    /// @notice Handles an incoming report forwarded by the KeystoneForwarder.
    /// @dev The forwarder has already verified the DON signatures on `report`
    ///      before calling. If this reverts the forwarder may retry with more gas.
    /// @param metadata Report metadata (workflow CID / name / owner / report name).
    /// @param report ABI-encoded workflow report payload.
    function onReport(bytes calldata metadata, bytes calldata report) external;
}
