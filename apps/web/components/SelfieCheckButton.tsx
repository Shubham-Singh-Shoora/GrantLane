"use client";

import { useCallback, useEffect, useState } from "react";
import type { IDKitResult } from "@worldcoin/idkit-core";
import { SelfieCheckRunner, type IDKitContext } from "./SelfieCheckRunner";

/**
 * Runs a Selfie Check and exchanges the proof for a server attestation that
 * authorises a payout-wallet change.
 *
 * Two details worth knowing:
 *
 *  - IDKit 4.x has no `IDKitWidget`. This uses `useIDKitRequest` (via
 *    SelfieCheckRunner) rather than `IDKitRequestWidget` so the grant flow and
 *    the standalone /verify page share one proven code path, and so a refused
 *    credential surfaces as its actual error code instead of a generic message.
 *
 *  - `rp_context` is required and must be signed with the Relying Party key, so
 *    it is fetched from /api/idkit-context. Contexts are short-lived; a fresh
 *    one is fetched for every attempt.
 */

export type Attestation = {
  grantId: string;
  newWallet: `0x${string}`;
  nullifierHash: `0x${string}`;
  nonce: string;
  deadline: string;
  signature: `0x${string}`;
  attestor: `0x${string}`;
};

type Props = {
  grantId: string;
  newWallet: string;
  disabled?: boolean;
  onAttested: (attestation: Attestation) => void;
};

export function SelfieCheckButton({ grantId, newWallet, disabled, onAttested }: Props) {
  const [context, setContext] = useState<IDKitContext | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // A context signed for one wallet must not be reused for another: the signal
  // binds the proof to this specific change.
  useEffect(() => {
    setContext(null);
    setStatus(null);
  }, [newWallet, grantId]);

  const begin = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const response = await fetch("/api/idkit-context", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.detail ?? body.error ?? "Could not start Selfie Check.");
        return;
      }
      setContext(body as IDKitContext);
    } catch (cause) {
      setStatus(`Could not start Selfie Check: ${String(cause)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const onResult = useCallback(
    async (result: IDKitResult) => {
      setStatus("Proof received — verifying with World…");
      try {
        const response = await fetch("/api/verify-selfie", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result, grantId, newWallet }),
        });
        const body = await response.json();
        if (!response.ok || !body.verified) {
          setStatus(body.detail ?? body.error ?? "Verification failed.");
          return;
        }
        onAttested(body.attestation as Attestation);
        setStatus("Verified. Attestation issued.");
      } catch (cause) {
        setStatus(`Verification failed: ${String(cause)}`);
      }
    },
    [grantId, newWallet, onAttested],
  );

  if (!context) {
    return (
      <div className="space-y-2">
        <button className="btn-primary" onClick={begin} disabled={disabled || loading}>
          {loading ? "Preparing…" : "Verify with Selfie Check"}
        </button>
        {status && <p className="text-xs text-danger">{status}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SelfieCheckRunner context={context} signal={`${grantId}:${newWallet}`} onResult={onResult} />
      {status && <p className="text-xs text-muted">{status}</p>}
    </div>
  );
}
