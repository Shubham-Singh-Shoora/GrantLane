// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IReceiver} from "./interfaces/IReceiver.sol";

/// @title ReceiverTemplate
/// @notice Base contract for CRE consumer contracts. Validates that a report came
///         from the configured KeystoneForwarder and, optionally, from a specific
///         workflow owner / name, then hands the payload to `_processReport`.
/// @dev Chainlink publishes a `ReceiverTemplate.sol` as a copy-paste file in its docs
///      rather than as an npm package, so this is an independent implementation of the
///      same documented behaviour: constructor takes the forwarder address, subclasses
///      override `_processReport(bytes calldata)`.
abstract contract ReceiverTemplate is IReceiver, Ownable {
    /// @notice The only address permitted to call `onReport`.
    address public s_forwarderAddress;
    /// @notice Optional gate: when set, only reports from this workflow owner are accepted.
    address public s_expectedAuthor;
    /// @notice Optional gate: when set, only reports from this workflow name are accepted.
    bytes10 public s_expectedWorkflowName;

    event ForwarderAddressUpdated(address indexed previous, address indexed current);
    event ExpectedAuthorUpdated(address indexed previous, address indexed current);
    event ExpectedWorkflowNameUpdated(bytes10 previous, bytes10 current);

    error InvalidForwarder(address caller, address expected);
    error InvalidAuthor(address author, address expected);
    error InvalidWorkflowName(bytes10 name, bytes10 expected);
    error ZeroAddress();

    constructor(address forwarderAddress) Ownable(msg.sender) {
        if (forwarderAddress == address(0)) revert ZeroAddress();
        s_forwarderAddress = forwarderAddress;
        emit ForwarderAddressUpdated(address(0), forwarderAddress);
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata metadata, bytes calldata report) external override {
        if (msg.sender != s_forwarderAddress) {
            revert InvalidForwarder(msg.sender, s_forwarderAddress);
        }

        (bytes10 workflowName, address workflowOwner) = _decodeMetadata(metadata);

        address expectedAuthor = s_expectedAuthor;
        if (expectedAuthor != address(0) && workflowOwner != expectedAuthor) {
            revert InvalidAuthor(workflowOwner, expectedAuthor);
        }

        bytes10 expectedName = s_expectedWorkflowName;
        if (expectedName != bytes10(0) && workflowName != expectedName) {
            revert InvalidWorkflowName(workflowName, expectedName);
        }

        _processReport(report);
    }

    /// @notice Implemented by the consuming contract with its own business logic.
    /// @param report ABI-encoded workflow report payload.
    function _processReport(bytes calldata report) internal virtual;

    /// @dev Keystone metadata layout, after the 32-byte length prefix:
    ///      offset 32: workflow_cid   (32 bytes)
    ///      offset 64: workflow_name  (10 bytes)
    ///      offset 74: workflow_owner (20 bytes)
    ///      offset 94: report_name    (2 bytes)
    ///      Matches `KeystoneFeedDefaultMetadataLib._extractMetadataInfo`.
    function _decodeMetadata(bytes memory metadata)
        internal
        pure
        returns (bytes10 workflowName, address workflowOwner)
    {
        assembly {
            workflowName := mload(add(metadata, 64))
            workflowOwner := shr(mul(12, 8), mload(add(metadata, 74)))
        }
    }

    function setForwarderAddress(address forwarderAddress) external onlyOwner {
        if (forwarderAddress == address(0)) revert ZeroAddress();
        emit ForwarderAddressUpdated(s_forwarderAddress, forwarderAddress);
        s_forwarderAddress = forwarderAddress;
    }

    function setExpectedAuthor(address author) external onlyOwner {
        emit ExpectedAuthorUpdated(s_expectedAuthor, author);
        s_expectedAuthor = author;
    }

    function setExpectedWorkflowName(bytes10 workflowName) external onlyOwner {
        emit ExpectedWorkflowNameUpdated(s_expectedWorkflowName, workflowName);
        s_expectedWorkflowName = workflowName;
    }

    /// @inheritdoc IERC165
    function supportsInterface(bytes4 interfaceId) public pure virtual override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
