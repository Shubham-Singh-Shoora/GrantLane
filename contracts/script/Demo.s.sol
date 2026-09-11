// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GrantEscrow} from "../src/GrantEscrow.sol";
import {IOptimisticOracleV3} from "../src/interfaces/IOptimisticOracleV3.sol";
import {IMockOracleAncillary, UmaSandbox} from "./UmaSandbox.sol";

/// @notice Drives a deployed GrantEscrow on Base Sepolia from the command line, one step
///         per call, so each transaction can be inspected on a block explorer.
/// @dev Env: GRANT_ESCROW_ADDRESS, DEPLOYER_PRIVATE_KEY (grantor), APPLICANT_ADDRESS,
///      APPLICANT_PRIVATE_KEY, ATTESTOR_PRIVATE_KEY.
///
///      The web app issues a claim attestation only after verifying a real World ID Selfie
///      Check. This script has no proof to verify, so it signs the attestation directly with
///      the attestor key and uses a nullifier labelled as CLI-issued — it exercises the
///      contract, not the Selfie Check.
///
///      forge script script/Demo.s.sol:Demo --rpc-url base_sepolia --broadcast \
///        --sig "claim(uint256,uint256,string)" 0 0 "https://…"
contract Demo is Script {
    IOptimisticOracleV3 internal constant OO = IOptimisticOracleV3(0x0F7fC5E6482f096380db6158f978167b57388deE);
    IMockOracleAncillary internal constant UMA_SANDBOX = IMockOracleAncillary(0x54e38A62ED3dC88e2B80cBA50deB940580511D26);
    IERC20 internal constant USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);

    bytes32 private constant MILESTONE_CLAIM_TYPEHASH = keccak256(
        "MilestoneClaim(uint256 grantId,uint256 milestoneId,bytes32 evidenceHash,bytes32 nullifierHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant CLI_NULLIFIER = keccak256("grantlane: CLI demo attestation, no Selfie Check proof");

    string private constant DEMO_TERMS =
        "GrantLane demo grant. Milestone 0 (2 USDC): publish the GrantEscrow contract source with a passing test suite. "
        "Milestone 1 (2 USDC): deploy it to Base Sepolia and publish the address.";

    /// @notice Grantor funds a two-milestone, 4 USDC grant for the applicant wallet.
    function createGrant() external returns (uint256 grantId) {
        GrantEscrow escrow = _escrow();
        uint128[] memory amounts = new uint128[](2);
        amounts[0] = 2e6;
        amounts[1] = 2e6;

        vm.startBroadcast(_key("DEPLOYER_PRIVATE_KEY"));
        USDC.approve(address(escrow), 4e6);
        grantId = escrow.createGrant(vm.envAddress("APPLICANT_ADDRESS"), amounts, keccak256(bytes(DEMO_TERMS)));
        vm.stopBroadcast();

        console.log("grantId:", grantId);
        console.log("terms:  ", DEMO_TERMS);
    }

    /// @notice Applicant posts the bond and asserts the milestone on UMA.
    function claim(uint256 grantId, uint256 milestoneId, string calldata evidenceURI) external {
        GrantEscrow escrow = _escrow();
        bytes32 evidenceHash = keccak256(bytes(evidenceURI));
        GrantEscrow.SelfieAttestation memory selfie = _attest(escrow, grantId, milestoneId, evidenceHash);

        vm.startBroadcast(_key("APPLICANT_PRIVATE_KEY"));
        USDC.approve(address(escrow), escrow.bond());
        escrow.submitMilestone(grantId, milestoneId, evidenceURI, evidenceHash, selfie);
        vm.stopBroadcast();

        // The assertion id and expiry embed the block timestamp, so values read here come
        // from forge's local simulation, not the mined block. `status` reads the real ones.
        console.log("claim sent; run status(uint256) for the mined assertion id and expiry");
    }

    /// @notice Grantor disputes a live claim on UMA, matching the bond.
    function dispute(uint256 grantId, uint256 milestoneId) external {
        GrantEscrow escrow = _escrow();
        uint256 key = _key("DEPLOYER_PRIVATE_KEY");
        bytes32 assertionId = escrow.getMilestones(grantId)[milestoneId].assertionId;

        vm.startBroadcast(key);
        USDC.approve(address(OO), escrow.bond());
        OO.disputeAssertion(assertionId, vm.addr(key));
        vm.stopBroadcast();
    }

    /// @notice Answers a dispute through UMA's sandbox oracle — the testnet stand-in for
    ///         UMA's token-holder vote.
    function resolve(uint256 grantId, uint256 milestoneId, bool claimWasTrue) external {
        GrantEscrow escrow = _escrow();
        GrantEscrow.Milestone memory m = escrow.getMilestones(grantId)[milestoneId];
        // The escrow asserts and stamps expiresAt in one transaction, so this is the
        // assertion time the oracle's price request was made for.
        uint256 assertionTime = m.expiresAt - escrow.liveness();

        vm.startBroadcast(_key("DEPLOYER_PRIVATE_KEY"));
        UMA_SANDBOX.pushPrice(
            escrow.identifier(),
            assertionTime,
            // The grantee is the asserter: they call submitMilestone.
            UmaSandbox.disputeAncillaryData(m.assertionId, escrow.getGrant(grantId).grantee),
            claimWasTrue ? UmaSandbox.TRUE : UmaSandbox.FALSE
        );
        vm.stopBroadcast();
    }

    /// @notice Settles a claim. Anyone can; the grantor's key just pays the gas here.
    function settle(uint256 grantId, uint256 milestoneId) external {
        GrantEscrow escrow = _escrow();
        vm.startBroadcast(_key("DEPLOYER_PRIVATE_KEY"));
        escrow.settle(grantId, milestoneId);
        vm.stopBroadcast();
    }

    /// @notice Applicant withdraws everything credited to them.
    function withdraw() external {
        GrantEscrow escrow = _escrow();
        vm.startBroadcast(_key("APPLICANT_PRIVATE_KEY"));
        uint256 amount = escrow.withdraw();
        vm.stopBroadcast();
        console.log("withdrawn (USDC base units):", amount);
    }

    /// @notice Prints a grant's milestones.
    function status(uint256 grantId) external view {
        GrantEscrow escrow = _escrow();
        GrantEscrow.Milestone[] memory ms = escrow.getMilestones(grantId);
        for (uint256 i = 0; i < ms.length; ++i) {
            console.log("milestone", i);
            console.log("  status (0 Pending,1 Asserted,2 Disputed,3 Approved,4 Rejected):", uint8(ms[i].status));
            console.log("  expiresAt:", ms[i].expiresAt);
            console.logBytes32(ms[i].assertionId);
        }
        console.log("applicant credit:", escrow.pendingWithdrawals(escrow.getGrant(grantId).payoutWallet));
        console.log("awaiting settlement:", escrow.awaitingSettlement().length);
    }

    function _attest(GrantEscrow escrow, uint256 grantId, uint256 milestoneId, bytes32 evidenceHash)
        internal
        view
        returns (GrantEscrow.SelfieAttestation memory)
    {
        uint256 deadline = block.timestamp + 10 minutes;
        bytes32 structHash = keccak256(
            abi.encode(
                MILESTONE_CLAIM_TYPEHASH,
                grantId,
                milestoneId,
                evidenceHash,
                CLI_NULLIFIER,
                escrow.claimNonce(grantId),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", escrow.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_key("ATTESTOR_PRIVATE_KEY"), digest);
        return GrantEscrow.SelfieAttestation(CLI_NULLIFIER, deadline, abi.encodePacked(r, s, v));
    }

    function _escrow() internal view returns (GrantEscrow) {
        return GrantEscrow(vm.envAddress("GRANT_ESCROW_ADDRESS"));
    }

    /// @dev Accepts keys with or without a 0x prefix.
    function _key(string memory name) internal view returns (uint256) {
        string memory raw = vm.envString(name);
        bytes memory b = bytes(raw);
        bool prefixed = b.length > 1 && b[0] == "0" && (b[1] == "x" || b[1] == "X");
        return vm.parseUint(prefixed ? raw : string.concat("0x", raw));
    }
}
