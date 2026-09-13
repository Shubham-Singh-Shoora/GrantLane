// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GrantEscrow} from "../src/GrantEscrow.sol";
import {DisputeRegistry} from "../src/DisputeRegistry.sol";

/// @notice Deploys the DisputeRegistry beside an existing GrantEscrow.
/// @dev Env: GRANT_ESCROW_ADDRESS. The registry reads the oracle, USDC and bond from
///      the escrow, so nothing else needs configuring.
///
///      forge script script/DeployDisputeRegistry.s.sol:DeployDisputeRegistry \
///        --rpc-url base_sepolia --private-key $DEPLOYER_PRIVATE_KEY --broadcast
contract DeployDisputeRegistry is Script {
    function run() external returns (DisputeRegistry registry) {
        GrantEscrow escrow = GrantEscrow(vm.envAddress("GRANT_ESCROW_ADDRESS"));

        vm.startBroadcast();
        registry = new DisputeRegistry(escrow);
        vm.stopBroadcast();

        console.log("DisputeRegistry:", address(registry));
        console.log("escrow:         ", address(escrow));
        console.log("oracle:         ", address(registry.oracle()));
        console.log("usdc:           ", address(registry.usdc()));
    }
}
