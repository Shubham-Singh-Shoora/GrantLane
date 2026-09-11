import { defineChain } from "viem";

export const CHAIN_ID = 84532;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "https://sepolia.base.org";
export const EXPLORER_URL = "https://sepolia.basescan.org";

/**
 * GrantLane runs on Base Sepolia. UMA's Optimistic Oracle V3 is deployed there with
 * a sandbox oracle for answering disputes, and Circle USDC is whitelisted as a UMA
 * bond — so grant escrow, claim bonds and dispute bonds are all the same USDC.
 *
 * Defined here rather than imported from `viem/chains`: that entry point is a
 * barrel of every chain viem knows, and pulling it in bundles far more than one
 * chain definition.
 */
export const appChain = defineChain({
  id: CHAIN_ID,
  name: "Base Sepolia",
  nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
  },
  blockExplorers: {
    default: { name: "Basescan", url: EXPLORER_URL },
  },
  testnet: true,
});

export function explorerTx(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddress(address: string): string {
  return `${EXPLORER_URL}/address/${address}`;
}
