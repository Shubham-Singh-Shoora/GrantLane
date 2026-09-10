"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "@wagmi/core";
import { ARC_CHAIN_ID } from "@/lib/chain";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletBadge() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (!isConnected || !address) {
    return (
      <button className="btn-primary" onClick={() => connect({ connector: injected() })} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  const wrongChain = chainId !== undefined && chainId !== ARC_CHAIN_ID;

  return (
    <button
      className="btn-secondary font-body text-[13px] font-semibold"
      onClick={() => disconnect()}
      title={wrongChain ? `Connected to chain ${chainId} — switch to Arc Testnet` : "Disconnect"}
      style={{ gap: 8 }}
    >
      <span
        className="h-[7px] w-[7px] flex-none rounded-full"
        style={{ background: wrongChain ? "var(--color-accent)" : "var(--color-accent-2)" }}
        aria-hidden
      />
      <span className="mono">{short(address)}</span>
      {wrongChain && <span className="tag tag-accent ml-1">Wrong network</span>}
    </button>
  );
}
