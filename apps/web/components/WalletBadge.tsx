"use client";

import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { injected } from "@wagmi/core";
import { CHAIN_ID } from "@/lib/chain";

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletBadge() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  if (!isConnected || !address) {
    return (
      <button className="btn-primary" onClick={() => connect({ connector: injected() })} disabled={isPending}>
        {isPending ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  const wrongChain = chainId !== undefined && chainId !== CHAIN_ID;

  if (wrongChain) {
    return (
      <button
        className="btn-secondary font-body text-[13px] font-semibold"
        onClick={() => switchChain({ chainId: CHAIN_ID })}
        disabled={switching}
        title={`Connected to chain ${chainId}`}
        style={{ gap: 8 }}
      >
        <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: "var(--color-accent)" }} aria-hidden />
        <span className="mono">{short(address)}</span>
        <span className="tag tag-accent ml-1">{switching ? "Switching…" : "Switch to Base Sepolia"}</span>
      </button>
    );
  }

  return (
    <button
      className="btn-secondary font-body text-[13px] font-semibold"
      onClick={() => disconnect()}
      title="Disconnect"
      style={{ gap: 8 }}
    >
      <span className="h-[7px] w-[7px] flex-none rounded-full" style={{ background: "var(--color-accent-2)" }} aria-hidden />
      <span className="mono">{short(address)}</span>
    </button>
  );
}
