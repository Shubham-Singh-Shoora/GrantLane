// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {GrantEscrow} from "../src/GrantEscrow.sol";

/// @notice Deploys GrantEscrow to Arc Testnet (chainId 5042002).
/// @dev Required env vars:
///        KEYSTONE_FORWARDER  - CRE KeystoneForwarder address for the target chain
///        ATTESTOR_ADDRESS    - address of the server key that signs Selfie Check attestations
///      Optional:
///        EXPECTED_WORKFLOW_OWNER - if set, only reports from this workflow owner are accepted
///
///      forge script script/Deploy.s.sol:Deploy \
///        --rpc-url $ARC_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast
contract Deploy is Script {
    function run() external returns (GrantEscrow escrow) {
        address forwarder = vm.envAddress("KEYSTONE_FORWARDER");
        address attestor = vm.envAddress("ATTESTOR_ADDRESS");
        address expectedOwner = vm.envOr("EXPECTED_WORKFLOW_OWNER", address(0));

        vm.startBroadcast();

        escrow = new GrantEscrow(forwarder, attestor);
        if (expectedOwner != address(0)) {
            escrow.setExpectedAuthor(expectedOwner);
        }

        vm.stopBroadcast();

        console.log("GrantEscrow:", address(escrow));
        console.log("forwarder:  ", forwarder);
        console.log("attestor:   ", attestor);
        console.log("chainId:    ", block.chainid);
    }
}
