import { defineChain } from "viem";

export const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002);
export const ARC_RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.io";

/**
 * Arc Testnet.
 *
 * USDC is the native gas token, but at **18 decimals** — not the 6 decimals the
 * USDC ERC-20 uses. Both live in this app: gas/native balances are 18-decimal,
 * while escrowed amounts (`formatUsdc` in lib/contracts) are 6-decimal ERC-20
 * units. Mixing them up is a 10^12 error, so keep the two paths separate.
 */
export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 18 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
  },
  testnet: true,
});
