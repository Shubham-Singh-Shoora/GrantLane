"use client";

import { useState } from "react";
import { isAddress } from "viem";
import { useAccount, useWriteContract } from "wagmi";
import { grantEscrowAbi } from "@/lib/contracts";
import { SelfieCheckButton, type Attestation } from "./SelfieCheckButton";

/**
 * Changing where a grant pays out is the one action worth gating on proof of a
 * live human: it is the step an attacker would take after stealing a session.
 * The flow is Selfie Check -> server verifies the proof and signs an EIP-712
 * attestation -> the grantee submits that attestation on-chain themselves.
 */
export function PayoutWalletPanel({
  grantId,
  escrowAddress,
  currentPayoutWallet,
  isGrantee,
}: {
  grantId: string;
  escrowAddress: `0x${string}`;
  currentPayoutWallet: string;
  isGrantee: boolean;
}) {
  const { isConnected } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  const [newWallet, setNewWallet] = useState("");
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const walletValid = isAddress(newWallet);

  async function applyChange() {
    if (!attestation) return;
    setNote(null);
    try {
      const hash = await writeContractAsync({
        address: escrowAddress,
        abi: grantEscrowAbi,
        functionName: "changePayoutWallet",
        args: [
          BigInt(attestation.grantId),
          attestation.newWallet,
          attestation.nullifierHash,
          BigInt(attestation.deadline),
          attestation.signature,
        ],
      });
      setNote(`Submitted: ${hash}`);
      setAttestation(null);
    } catch (cause) {
      setNote(String(cause instanceof Error ? cause.message : cause));
    }
  }

  if (!isGrantee) {
    return (
      <section className="panel p-5">
        <h2 className="text-sm font-semibold text-slate-100">Payout wallet</h2>
        <p className="mt-2 break-all font-mono text-xs text-muted">{currentPayoutWallet}</p>
        <p className="mt-2 text-xs text-muted">Only the grantee can change this, and only after a Selfie Check.</p>
      </section>
    );
  }

  return (
    <section className="panel p-5">
      <h2 className="text-sm font-semibold text-slate-100">Payout wallet</h2>
      <p className="mt-1 break-all font-mono text-xs text-muted">{currentPayoutWallet}</p>

      <div className="mt-4 space-y-3">
        <div>
          <label className="label" htmlFor="new-wallet">
            New payout wallet
          </label>
          <input
            id="new-wallet"
            className="field font-mono text-xs"
            value={newWallet}
            onChange={(e) => {
              setNewWallet(e.target.value);
              setAttestation(null);
            }}
            placeholder="0x…"
          />
          {newWallet.length > 0 && !walletValid && (
            <p className="mt-1 text-xs text-danger">Not a valid address.</p>
          )}
        </div>

        {!attestation ? (
          <SelfieCheckButton
            grantId={grantId}
            newWallet={newWallet}
            disabled={!walletValid}
            onAttested={setAttestation}
          />
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-accent">
              Verified. Attestation valid until{" "}
              {new Date(Number(attestation.deadline) * 1000).toLocaleTimeString()}.
            </p>
            <button className="btn-primary" onClick={applyChange} disabled={!isConnected || isPending}>
              {isPending ? "Confirming…" : "Apply change on-chain"}
            </button>
          </div>
        )}

        {note && <p className="break-all text-xs text-muted">{note}</p>}
      </div>
    </section>
  );
}
