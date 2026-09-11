// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @notice UMA's sandbox oracle. On testnets it stands in for UMA's token-holder vote and
///         answers disputed assertions; anyone can push the answer.
interface IMockOracleAncillary {
    function pushPrice(bytes32 identifier, uint256 time, bytes memory ancillaryData, int256 price) external;
}

/// @notice Helpers for answering an OOv3 dispute through the sandbox oracle.
library UmaSandbox {
    /// @dev ASSERT_TRUTH answers: 1e18 means the assertion was true.
    int256 internal constant TRUE = 1e18;
    int256 internal constant FALSE = 0;

    /// @notice Rebuilds the ancillary data OOv3 attaches to a dispute's price request.
    /// @dev Mirrors OptimisticOracleV3._stampAssertion and UMA's AncillaryData library:
    ///      "assertionId:<64 hex>,ooAsserter:<40 hex>", lowercase with no 0x. Despite the
    ///      key's name, `ooAsserter` is the assertion's asserter — for GrantEscrow, the
    ///      grantee — not the oracle. The sandbox refuses answers to requests it never
    ///      received, so a mismatch fails loudly.
    function disputeAncillaryData(bytes32 assertionId, address asserter) internal pure returns (bytes memory) {
        return abi.encodePacked(
            "assertionId:",
            _strip0x(Strings.toHexString(uint256(assertionId), 32)),
            ",ooAsserter:",
            _strip0x(Strings.toHexString(asserter))
        );
    }

    function _strip0x(string memory hexString) private pure returns (bytes memory out) {
        bytes memory raw = bytes(hexString);
        out = new bytes(raw.length - 2);
        for (uint256 i = 0; i < out.length; ++i) {
            out[i] = raw[i + 2];
        }
    }
}
