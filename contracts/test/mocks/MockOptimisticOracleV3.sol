// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IOptimisticOracleV3} from "../../src/interfaces/IOptimisticOracleV3.sol";
import {IOptimisticOracleV3CallbackRecipient} from "../../src/interfaces/IOptimisticOracleV3CallbackRecipient.sol";

/// @notice Stand-in for UMA's Optimistic Oracle V3 that follows its bond and callback rules.
/// @dev Mirrors the behaviour GrantEscrow relies on:
///      - the bond is pulled from msg.sender, not from `asserter`;
///      - disputes must land before expiry, and the disputer matches the bond;
///      - an undisputed assertion settles true once expired and returns the bond;
///      - a disputed one settles to the resolved answer, the winner takes 2x bond minus
///        UMA's 50% burn of the loser's bond;
///      - callbacks fire on dispute and on settlement, and a reverting callback reverts both.
///      resolveDispute() plays the part of the DVM (or the sandbox MockOracleAncillary).
contract MockOptimisticOracleV3 is IOptimisticOracleV3 {
    using SafeERC20 for IERC20;

    struct Assertion {
        bytes claim;
        address asserter;
        address callbackRecipient;
        IERC20 currency;
        uint256 bond;
        uint64 liveness;
        uint64 expirationTime;
        bytes32 identifier;
        address disputer;
        bool resolved;
        bool resolution;
        bool settled;
    }

    bytes32 public constant DEFAULT_IDENTIFIER = "ASSERT_TRUTH";
    uint256 public constant BURNED_BOND_PERCENTAGE = 0.5e18;
    /// @dev Where the burned half of a losing bond goes (UMA's Store).
    address public constant STORE = address(0x5702E);

    uint256 public minimumBond;
    uint256 private s_nonce;
    mapping(bytes32 => Assertion) private s_assertions;

    constructor(uint256 minimumBond_) {
        minimumBond = minimumBond_;
    }

    function assertTruth(
        bytes memory claim,
        address asserter,
        address callbackRecipient,
        address, /* escalationManager */
        uint64 liveness,
        IERC20 currency,
        uint256 bond,
        bytes32 identifier,
        bytes32 /* domainId */
    ) external returns (bytes32 assertionId) {
        require(asserter != address(0), "Asserter cant be 0");
        require(bond >= minimumBond, "Bond amount too low");
        require(liveness > 0, "Liveness must be > 0");

        assertionId = keccak256(abi.encode(claim, asserter, block.timestamp, s_nonce++));
        Assertion storage a = s_assertions[assertionId];
        a.claim = claim;
        a.asserter = asserter;
        a.callbackRecipient = callbackRecipient;
        a.currency = currency;
        a.bond = bond;
        a.liveness = liveness;
        a.expirationTime = uint64(block.timestamp) + liveness;
        a.identifier = identifier;

        currency.safeTransferFrom(msg.sender, address(this), bond);
    }

    function disputeAssertion(bytes32 assertionId, address disputer) external {
        Assertion storage a = s_assertions[assertionId];
        require(a.asserter != address(0), "Assertion does not exist");
        require(disputer != address(0), "Disputer can't be 0");
        require(a.disputer == address(0), "Assertion already disputed");
        require(a.expirationTime > block.timestamp, "Assertion is expired");

        a.disputer = disputer;
        a.currency.safeTransferFrom(msg.sender, address(this), a.bond);

        if (a.callbackRecipient != address(0)) {
            IOptimisticOracleV3CallbackRecipient(a.callbackRecipient).assertionDisputedCallback(assertionId);
        }
    }

    /// @notice Test hook standing in for the DVM's answer. `true` means the claim was true.
    function resolveDispute(bytes32 assertionId, bool resolution) external {
        Assertion storage a = s_assertions[assertionId];
        require(a.disputer != address(0), "Not disputed");
        a.resolved = true;
        a.resolution = resolution;
    }

    function settleAssertion(bytes32 assertionId) public {
        Assertion storage a = s_assertions[assertionId];
        require(a.asserter != address(0), "Assertion does not exist");
        require(!a.settled, "Assertion already settled");
        a.settled = true;

        if (a.disputer == address(0)) {
            require(a.expirationTime <= block.timestamp, "Assertion not expired");
            a.resolution = true;
            a.currency.safeTransfer(a.asserter, a.bond);
        } else {
            require(a.resolved, "Dispute not resolved");
            uint256 fee = (a.bond * BURNED_BOND_PERCENTAGE) / 1e18;
            address winner = a.resolution ? a.asserter : a.disputer;
            a.currency.safeTransfer(winner, a.bond * 2 - fee);
            a.currency.safeTransfer(STORE, fee);
        }

        if (a.callbackRecipient != address(0)) {
            IOptimisticOracleV3CallbackRecipient(a.callbackRecipient).assertionResolvedCallback(
                assertionId, a.resolution
            );
        }
    }

    function getAssertionResult(bytes32 assertionId) external view returns (bool) {
        Assertion storage a = s_assertions[assertionId];
        require(a.settled, "Assertion not settled");
        return a.resolution;
    }

    function defaultIdentifier() external pure returns (bytes32) {
        return DEFAULT_IDENTIFIER;
    }

    function getMinimumBond(address) external view returns (uint256) {
        return minimumBond;
    }

    function getAssertion(bytes32 assertionId) external view returns (Assertion memory) {
        return s_assertions[assertionId];
    }
}
