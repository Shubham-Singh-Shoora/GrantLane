"use client";

import { useCallback } from "react";
import type { TransactionReceipt } from "viem";
import { useAccount, usePublicClient, useSwitchChain, useWriteContract } from "wagmi";
import { CHAIN_ID } from "./chain";

type WriteRequest = Parameters<ReturnType<typeof useWriteContract>["writeContractAsync"]>[0];

/**
 * Sends one contract write on Base Sepolia and waits for it to be mined.
 *
 * Every write in the app goes through this so three things are always true: the
 * wallet is switched to the right chain first, the caller only continues once the
 * transaction is in a block, and a revert throws instead of looking like success.
 */
export function useChainTx() {
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: CHAIN_ID });

  return useCallback(
    async (request: WriteRequest): Promise<{ hash: `0x${string}`; receipt: TransactionReceipt }> => {
      if (chainId !== CHAIN_ID) {
        await switchChainAsync({ chainId: CHAIN_ID });
      }
      const hash = await writeContractAsync({ ...request, chainId: CHAIN_ID } as WriteRequest);
      if (!publicClient) throw new Error("No Base Sepolia RPC client available.");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
      return { hash, receipt };
    },
    [chainId, switchChainAsync, writeContractAsync, publicClient],
  );
}

/** viem errors are long; the first line or the short message is what a person needs. */
export function txErrorMessage(cause: unknown): string {
  if (cause && typeof cause === "object") {
    const error = cause as { shortMessage?: string; message?: string };
    if (error.shortMessage) return error.shortMessage;
    if (error.message) return error.message.split("\n")[0];
  }
  return String(cause);
}
