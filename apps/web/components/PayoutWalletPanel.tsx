"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { grantEscrowAbi } from "@/lib/contracts";
import { shortAddress } from "@/lib/status";
import { txErrorMessage, useChainTx } from "@/lib/useChainTx";
import { SelfieCheckButton, type Attestation } from "./SelfieCheckButton";

/**
 * Changing where a grant pays out is worth gating on proof of a live human: it is
 * the step an attacker would take after stealing a session. The flow is Selfie
 * Check -> server verifies the proof and signs an EIP-712 attestation -> the
 * grantee submits that attestation on-chain themselves.
 */
export function PayoutWalletPanel({
  grantId,
  escrowAddress,
  currentPayoutWallet,
  isGrantee,
  onActivity,
}: {
  grantId: string;
  escrowAddress: `0x${string}`;
  currentPayoutWallet: string;
  isGrantee: boolean;
  /** Tells the page a transaction just landed, so it keeps re-reading the chain for a while. */
  onActivity?: () => void;
}) {
  const router = useRouter();
  const { isConnected } = useAccount();
  const send = useChainTx();

  const [editing, setEditing] = useState(false);
  const [newWallet, setNewWallet] = useState("");
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const walletValid = isAddress(newWallet);
  const walletError = newWallet.length > 0 && !walletValid ? "Not a valid address." : null;

  // Attestations expire; a visible countdown is the honest way to show it.
  useEffect(() => {
    if (!attestation) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [attestation]);

  const remaining = useMemo(() => {
    if (!attestation) return null;
    const left = Number(attestation.deadline) - now;
    if (left <= 0) return "expired";
    return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  }, [attestation, now]);

  async function applyChange() {
    if (!attestation) return;
    setBusy(true);
    setNote(null);
    try {
      const { hash } = await send({
        address: escrowAddress,
        abi: grantEscrowAbi,
        functionName: "changePayoutWallet",
        args: [
          BigInt(attestation.grantId),
          attestation.newWallet,
          {
            nullifierHash: attestation.nullifierHash,
            deadline: BigInt(attestation.deadline),
            signature: attestation.signature,
          },
        ],
      });
      setNote(`Payout wallet changed: ${hash}`);
      setAttestation(null);
      setEditing(false);
      setNewWallet("");
      onActivity?.();
      router.refresh();
    } catch (cause) {
      setNote(txErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setEditing(false);
    setAttestation(null);
    setNewWallet("");
    setNote(null);
  }

  return (
    <section className="card elev-sm" style={{ padding: 22, gap: 12 }}>
      <h4 className="m-0">Payout wallet</h4>
      <p className="mono m-0 break-all text-[12.5px]" style={{ opacity: 0.8 }} title={currentPayoutWallet}>
        {shortAddress(currentPayoutWallet, 14, 8)}
      </p>
      <p className="m-0 text-[12.5px]" style={{ opacity: 0.6 }}>
        Where approved milestones are credited.
      </p>

      <div className="rule my-0.5" />

      {!isGrantee && (
        <p className="m-0 text-[13px]" style={{ opacity: 0.7 }}>
          Only the grantee can change this, and only after a Selfie Check.
        </p>
      )}

      {isGrantee && !editing && !attestation && (
        <div>
          <p className="m-0 mb-2.5 text-[13.5px]" style={{ opacity: 0.8 }}>
            Changing where this grant pays out needs a fresh proof that you&apos;re a live human — it&apos;s the one
            action a stolen session would go for.
          </p>
          <button className="btn-secondary font-body font-semibold" onClick={() => setEditing(true)}>
            Change payout wallet
          </button>
        </div>
      )}

      {isGrantee && editing && !attestation && (
        <div className="animate-rise flex flex-col gap-3">
          <div className="field">
            <label htmlFor="new-wallet">New payout wallet</label>
            <input
              id="new-wallet"
              className="input mono text-[12.5px]"
              value={newWallet}
              onChange={(e) => setNewWallet(e.target.value)}
              placeholder="0x…"
            />
          </div>
          {walletError && (
            <p className="m-0 text-xs" style={{ color: "var(--color-accent-700)" }}>
              {walletError}
            </p>
          )}

          <SelfieCheckButton
            grantId={grantId}
            newWallet={newWallet}
            disabled={!walletValid}
            onAttested={setAttestation}
          />

          <button className="btn-secondary self-start font-body font-semibold" onClick={cancel}>
            Cancel
          </button>
        </div>
      )}

      {isGrantee && attestation && (
        <div
          className="animate-rise flex flex-col gap-2.5 rounded-[20px] px-4 py-3.5"
          style={{ background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)" }}
        >
          <p className="m-0 text-[13.5px]">
            <strong>Human verified.</strong>{" "}
            {remaining === "expired" ? "Attestation expired — run the check again." : `Attestation valid for ${remaining}.`}
          </p>
          <p className="mono m-0 break-all text-[11px]" style={{ opacity: 0.7 }}>
            → {shortAddress(attestation.newWallet, 12, 8)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-primary"
              onClick={applyChange}
              disabled={!isConnected || busy || remaining === "expired"}
            >
              {busy ? "Confirming…" : "Apply change on-chain"}
            </button>
            <button className="btn-secondary font-body font-semibold" onClick={cancel}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {note && (
        <p className="m-0 break-all text-xs" style={{ opacity: 0.7 }}>
          {note}
        </p>
      )}
    </section>
  );
}
