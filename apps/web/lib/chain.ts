import { defineChain } from "viem";

export const ARC_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ARC_CHAIN_ID ?? 5042002);
export const ARC_RPC_URL = process.env.NEXT_PUBLIC_ARC_RPC_URL ?? "https://rpc.testnet.arc.io";

/**
 * Arc Testnet. USDC is the native gas token, so `nativeCurrency` is USDC with
 * 6 decimals rather than an 18-decimal ETH-alike — anything formatting native
 * balances has to respect that.
 */
export const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USD Coin", symbol: "USDC", decimals: 6 },
  rpcUrls: {
    default: { http: [ARC_RPC_URL] },
  },
  testnet: true,
});
