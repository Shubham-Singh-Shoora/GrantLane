"use client";

import { useCallback, useEffect, useState } from "react";
import type { IDKitResult } from "@worldcoin/idkit-core";
import { SelfieCheckRunner, type IDKitContext } from "./SelfieCheckRunner";
import { loadTicket, saveTicket, ticketSecondsLeft } from "@/lib/ticket-cache";

export type SelfiePurpose = "application" | "milestone" | "payout-wallet";

/**
 * "Prove you're a live human, then continue."
 *
 * Used at the two points where a bot would otherwise be free to act: submitting
 * an application, and claiming a milestone is done. Both call the same endpoint
 * with a different `purpose`, and World scopes the nullifier to that purpose's
 * action — so a proof farmed against the application gate is worthless at the
 * milestone gate.
 *
 * The component owns only the verification; the caller decides what the returned
 * nullifier unlocks.
 */
export function SelfieGate({
  purpose,
  signal,
  title,
  body,
  verifiedLabel,
  cacheKey,
  onVerified,
}: {
  purpose: SelfiePurpose;
  signal: string;
  title: string;
  body: string;
  verifiedLabel?: string;
  /** Scopes the cached ticket. Omit to require a fresh check every time. */
  cacheKey?: string;
  onVerified: (verificationTicket: string) => void;
}) {
  const [context, setContext] = useState<IDKitContext | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [verified, setVerified] = useState(false);
  const [restoredFor, setRestoredFor] = useState<number | null>(null);

  // A ticket from a few minutes ago is still good. Reuse it rather than making
  // someone redo a face scan because the last submit failed downstream.
  useEffect(() => {
    if (!cacheKey) return;
    const cached = loadTicket(cacheKey);
    if (!cached) return;
    setVerified(true);
    setRestoredFor(ticketSecondsLeft(cached));
    onVerified(cached);
  }, [cacheKey, onVerified]);

  const begin = useCallback(async () => {
    setLoading(true);
    setStatus(null);
    try {
      const response = await fetch(`/api/idkit-context?purpose=${encodeURIComponent(purpose)}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        setStatus(payload.detail ?? payload.error ?? "Could not start Selfie Check.");
        return;
      }
      setContext(payload as IDKitContext);
    } catch (cause) {
      setStatus(`Could not start Selfie Check: ${String(cause)}`);
    } finally {
      setLoading(false);
    }
  }, [purpose]);

  const onResult = useCallback(
    async (result: IDKitResult) => {
      setStatus("Proof received — verifying with World…");
      try {
        const response = await fetch("/api/verify-selfie", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result, purpose }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.verified) {
          setStatus(payload.detail ?? payload.error ?? "Verification failed.");
          return;
        }
        setVerified(true);
        setStatus(null);
        if (cacheKey) saveTicket(cacheKey, payload.ticket as string);
        onVerified(payload.ticket as string);
      } catch (cause) {
        setStatus(`Verification failed: ${String(cause)}`);
      }
    },
    [purpose, cacheKey, onVerified],
  );

  if (verified) {
    return (
      <div
        className="animate-rise flex flex-wrap items-center gap-2.5 rounded-[20px] px-4 py-3"
        style={{ background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)" }}
      >
        <span
          className="grid h-6 w-6 flex-none place-items-center rounded-full text-xs"
          style={{ background: "var(--color-accent-2)", color: "var(--color-bg)" }}
          aria-hidden
        >
          ✓
        </span>
        <p className="m-0 text-[13.5px]">
          <strong>Human verified.</strong> {verifiedLabel ?? "You can continue."}
          {restoredFor !== null && restoredFor > 0 && (
            <span style={{ opacity: 0.7 }}>{" "}Reusing your check from a moment ago — valid for another{" "}
              {Math.ceil(restoredFor / 60)} min.</span>
          )}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-[22px] p-4"
      style={{ background: "color-mix(in srgb, var(--color-accent) 10%, transparent)" }}
    >
      <div>
        <p className="m-0 font-heading text-base">{title}</p>
        <p className="m-0 mt-1 text-[13px]" style={{ opacity: 0.8 }}>
          {body}
        </p>
      </div>

      {!context ? (
        <button className="btn-primary self-start" onClick={begin} disabled={loading}>
          {loading ? "Preparing…" : "Verify with Selfie Check"}
        </button>
      ) : (
        <SelfieCheckRunner context={context} signal={signal} onResult={onResult} />
      )}

      {status && (
        <p className="m-0 text-xs" style={{ opacity: 0.75 }}>
          {status}
        </p>
      )}
    </div>
  );
}
