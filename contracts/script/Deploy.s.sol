// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GrantEscrow} from "../src/GrantEscrow.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";

/// @notice Deploys GrantEscrow against UMA's Optimistic Oracle V3.
/// @dev Defaults target Base Sepolia (chainId 84532), where both addresses were checked
///      on-chain: Circle USDC is whitelisted as a UMA bond currency with a minimum of 0.
///
///      Required env vars:
///        ATTESTOR_ADDRESS  - server key that signs Selfie Check attestations
///      Optional:
///        UMA_OOV3_ADDRESS  - Optimistic Oracle V3 (default: Base Sepolia)
///        USDC_ADDRESS      - escrow and bond token (default: Base Sepolia Circle USDC)
///        LIVENESS_SECONDS  - dispute window (default: 300, the demo setting; use 172800 for 48h)
///        BOND_AMOUNT       - bond in USDC base units (default: 1000000 = 1 USDC)
///
///      forge script script/Deploy.s.sol:Deploy \
///        --rpc-url $BASE_SEPOLIA_RPC_URL --private-key $DEPLOYER_PRIVATE_KEY --broadcast
contract Deploy is Script {
    uint256 internal constant BASE_SEPOLIA = 84532;
    address internal constant BASE_SEPOLIA_OOV3 = 0x0F7fC5E6482f096380db6158f978167b57388deE;
    address internal constant BASE_SEPOLIA_USDC = 0x036CbD53842c5426634e7929541eC2318f3dCF7e;

    function run() external returns (GrantEscrow escrow) {
        address attestor = vm.envAddress("ATTESTOR_ADDRESS");
        address oracle = vm.envOr("UMA_OOV3_ADDRESS", BASE_SEPOLIA_OOV3);
        address usdc = vm.envOr("USDC_ADDRESS", BASE_SEPOLIA_USDC);
        uint64 liveness = uint64(vm.envOr("LIVENESS_SECONDS", uint256(300)));
        uint256 bond = vm.envOr("BOND_AMOUNT", uint256(1e6));

        // The defaults only exist on Base Sepolia; anywhere else they must be set explicitly.
        if (block.chainid != BASE_SEPOLIA) {
            require(
                oracle != BASE_SEPOLIA_OOV3 && usdc != BASE_SEPOLIA_USDC,
                "Not Base Sepolia: set UMA_OOV3_ADDRESS and USDC_ADDRESS"
            );
        }

        vm.startBroadcast();
        escrow = new GrantEscrow(IOptimisticOracleV3(oracle), IERC20(usdc), attestor, liveness, bond);
        vm.stopBroadcast();

        console.log("GrantEscrow:", address(escrow));
        console.log("oracle:     ", oracle);
        console.log("usdc:       ", usdc);
        console.log("attestor:   ", attestor);
        console.log("liveness s: ", liveness);
        console.log("bond:       ", bond);
        console.log("chainId:    ", block.chainid);
    }
}
