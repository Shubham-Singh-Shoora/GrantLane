import { stringToHex, toHex, type Address, type Hex } from "viem";

/**
 * UMA on Base Sepolia, checked on-chain.
 *
 * Disputes are raised directly on the Optimistic Oracle — GrantEscrow doesn't wrap
 * it, because UMA already lets anyone dispute any assertion. On this testnet a
 * dispute is answered through UMA's sandbox oracle, which anyone can push an
 * answer to; on mainnet the same dispute goes to UMA's token-holder vote.
 */
export const UMA_OOV3_ADDRESS: Address = "0x0F7fC5E6482f096380db6158f978167b57388deE";
export const UMA_SANDBOX_ORACLE_ADDRESS: Address = "0x54e38A62ED3dC88e2B80cBA50deB940580511D26";

/** GrantEscrow asserts under UMA's default identifier. */
export const ASSERT_TRUTH: Hex = stringToHex("ASSERT_TRUTH", { size: 32 });
export const UMA_TRUE = 10n ** 18n;
export const UMA_FALSE = 0n;

export const umaOptimisticOracleAbi = [
  {
    type: "function",
    name: "disputeAssertion",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assertionId", type: "bytes32" },
      { name: "disputer", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const umaSandboxOracleAbi = [
  {
    type: "function",
    name: "pushPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "identifier", type: "bytes32" },
      { name: "time", type: "uint256" },
      { name: "ancillaryData", type: "bytes" },
      { name: "price", type: "int256" },
    ],
    outputs: [],
  },
] as const;

/**
 * The ancillary data OOv3 stamps on a dispute's price request, which the sandbox
 * needs to find the request. Mirrors contracts/script/UmaSandbox.sol: despite the
 * key's name, `ooAsserter` is the assertion's asserter — the grantee — not the oracle.
 */
export function disputeAncillaryData(assertionId: Hex, asserter: Address): Hex {
  return toHex(`assertionId:${assertionId.slice(2).toLowerCase()},ooAsserter:${asserter.slice(2).toLowerCase()}`);
}
