"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "@wagmi/core";

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

  const wrongChain = chainId !== undefined && chainId !== 5042002;

  return (
    <div className="flex items-center gap-2">
      {wrongChain && (
        <span className="chip bg-warn/10 text-warn ring-warn/40" title={`Connected to chain ${chainId}`}>
          Wrong network
        </span>
      )}
      <button className="btn-ghost font-mono" onClick={() => disconnect()} title="Disconnect">
        {short(address)}
      </button>
    </div>
  );
}
