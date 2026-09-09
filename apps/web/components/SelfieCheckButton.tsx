"use client";

import { useCallback, useState } from "react";
import { IDKitRequestWidget, selfieCheckLegacy } from "@worldcoin/idkit";
import type { IDKitResult, RpContext } from "@worldcoin/idkit-core";

/**
 * Runs a World ID Selfie Check and exchanges the proof for a server attestation.
 *
 * Two details worth knowing:
 *
 *  - IDKit 4.x has no `IDKitWidget`. The request-mode component is
 *    `IDKitRequestWidget`, and the credential is chosen with a preset —
 *    `selfieCheckLegacy()`, which returns World ID 3.0 proofs.
 *
 *  - `rp_context` is required and must be signed with the Relying Party key, so
 *    it is fetched from /api/idkit-context immediately before opening. Contexts
 *    are short-lived; a new one is fetched on every attempt.
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

type IDKitContext = {
  app_id: `app_${string}`;
  action: string;
  rp_context: RpContext;
};

export function SelfieCheckButton({ grantId, newWallet, disabled, onAttested }: Props) {
  const [context, setContext] = useState<IDKitContext | null>(null);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const begin = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    try {
      const response = await fetch("/api/idkit-context", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setStatus(body.detail ?? "Could not start Selfie Check.");
        return;
      }
      setContext(body as IDKitContext);
      setOpen(true);
    } catch (cause) {
      setStatus(`Could not start Selfie Check: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * `handleVerify` runs before IDKit reports success, so a rejected proof or a
   * refused attestation surfaces as an IDKit error rather than a silent pass.
   */
  const handleVerify = useCallback(
    async (result: IDKitResult) => {
      const response = await fetch("/api/verify-selfie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, grantId, newWallet }),
      });
      const body = await response.json();
      if (!response.ok || !body.verified) {
        throw new Error(body.detail ?? body.error ?? "Verification failed.");
      }
      onAttested(body.attestation as Attestation);
      setStatus("Selfie Check verified. Attestation issued.");
    },
    [grantId, newWallet, onAttested],
  );

  return (
    <div className="space-y-2">
      <button className="btn-primary" onClick={begin} disabled={disabled || busy}>
        {busy ? "Preparing…" : "Verify with Selfie Check"}
      </button>

      {context && (
        <IDKitRequestWidget
          app_id={context.app_id}
          action={context.action}
          rp_context={context.rp_context}
          allow_legacy_proofs
          preset={selfieCheckLegacy({ signal: `${grantId}:${newWallet}` })}
          open={open}
          onOpenChange={setOpen}
          handleVerify={handleVerify}
          onSuccess={() => setOpen(false)}
          onError={(code) => setStatus(`Selfie Check failed: ${code}`)}
        />
      )}

      {status && <p className="text-xs text-muted">{status}</p>}
    </div>
  );
}
