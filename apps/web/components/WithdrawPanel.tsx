"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { CHAIN_ID } from "@/lib/chain";
import { formatUsdc, grantEscrowAbi } from "@/lib/contracts";
import { txErrorMessage, useChainTx } from "@/lib/useChainTx";

/**
 * Approved milestones are credited to the payout wallet rather than pushed to it,
 * so a transfer that fails can never block a settlement. This is where the payout
 * wallet collects. The balance is per wallet, across every grant on this escrow.
 */
export function WithdrawPanel({ escrowAddress }: { escrowAddress: Address }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const send = useChainTx();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const { data, refetch } = useReadContract({
    address: escrowAddress,
    abi: grantEscrowAbi,
    functionName: "pendingWithdrawals",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address },
  });
  const owed = (data as bigint | undefined) ?? 0n;

  async function withdraw() {
    setBusy(true);
    setNote(null);
    try {
      const { hash } = await send({ address: escrowAddress, abi: grantEscrowAbi, functionName: "withdraw" });
      setNote(`Withdrawn: ${hash}`);
      await refetch();
      router.refresh();
    } catch (cause) {
      setNote(txErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card elev-sm" style={{ padding: 22, gap: 10 }}>
      <h4 className="m-0">Withdraw</h4>
      {!isConnected ? (
        <p className="m-0 text-[13px]" style={{ opacity: 0.7 }}>
          Connect the payout wallet to collect approved milestones.
        </p>
      ) : (
        <>
          <p className="m-0 font-heading text-[26px] leading-none">{formatUsdc(owed)} USDC</p>
          <p className="m-0 text-[12.5px]" style={{ opacity: 0.6 }}>
            Owed to this wallet by approved milestones.
          </p>
          <button className="btn-primary self-start" onClick={withdraw} disabled={busy || owed === 0n}>
            {busy ? "Withdrawing…" : owed === 0n ? "Nothing to withdraw" : "Withdraw"}
          </button>
        </>
      )}
      {note && (
        <p className="m-0 break-all text-xs" style={{ opacity: 0.7 }}>
          {note}
        </p>
      )}
    </section>
  );
}
