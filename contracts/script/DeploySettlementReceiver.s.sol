// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SettlementReceiver} from "../src/automation/SettlementReceiver.sol";
import {AutomationCompatibleInterface} from "../src/interfaces/AutomationCompatibleInterface.sol";

/// @notice Deploys the SettlementReceiver that a CRE workflow writes GrantEscrow settlements through.
/// @dev Env:
///        GRANT_ESCROW_ADDRESS   - the escrow whose performUpkeep this relays to
///      Optional:
///        CRE_FORWARDER_ADDRESS  - defaults to Base Sepolia's MockKeystoneForwarder, which
///                                 `cre workflow simulate --broadcast` writes through. Once the
///                                 workflow is deployed to a DON, call setForwarderAddress with
///                                 the production KeystoneForwarder
///                                 (0xF8344CFd5c43616a4366C34E3EEE75af79a74482 on Base Sepolia).
///
///      forge script script/DeploySettlementReceiver.s.sol:DeploySettlementReceiver \
///        --rpc-url base_sepolia --private-key $DEPLOYER_PRIVATE_KEY --broadcast
contract DeploySettlementReceiver is Script {
    string internal constant BASE_SEPOLIA_MOCK_FORWARDER = "0x82300bd7c3958625581cc2f77bc6464dcecdf3e5";

    function run() external returns (SettlementReceiver receiver) {
        address escrow = vm.envAddress("GRANT_ESCROW_ADDRESS");
        address forwarder = vm.envOr("CRE_FORWARDER_ADDRESS", vm.parseAddress(BASE_SEPOLIA_MOCK_FORWARDER));

        vm.startBroadcast();
        receiver = new SettlementReceiver(forwarder, AutomationCompatibleInterface(escrow));
        vm.stopBroadcast();

        console.log("SettlementReceiver:", address(receiver));
        console.log("escrow:            ", escrow);
        console.log("forwarder:         ", forwarder);
    }
}
