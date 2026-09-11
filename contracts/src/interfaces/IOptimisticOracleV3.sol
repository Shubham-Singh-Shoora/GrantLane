// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IOptimisticOracleV3
/// @notice The subset of UMA's Optimistic Oracle V3 that GrantEscrow uses.
/// @dev Signatures copied from UMA's OptimisticOracleV3Interface. Deliberately
///      omits getAssertion(): its struct return is the one part of the ABI a
///      hand-copied interface could silently mis-decode, and GrantEscrow tracks
///      the state it needs itself instead of reading it back.
interface IOptimisticOracleV3 {
    function assertTruth(
        bytes memory claim,
        address asserter,
        address callbackRecipient,
        address escalationManager,
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 domainId
    ) external returns (bytes32);

    function disputeAssertion(bytes32 assertionId, address disputer) external;

    function settleAssertion(bytes32 assertionId) external;

    function getAssertionResult(bytes32 assertionId) external view returns (bool);

    function defaultIdentifier() external view returns (bytes32);

    function getMinimumBond(address currency) external view returns (uint256);
}
