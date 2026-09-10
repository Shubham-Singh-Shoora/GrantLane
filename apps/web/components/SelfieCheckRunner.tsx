"use client";

import { useEffect, useState } from "react";
import { useIDKitRequest, selfieCheckLegacy, setDebug } from "@worldcoin/idkit";
import type { IDKitResult, RpContext } from "@worldcoin/idkit-core";
import { QrCode } from "./QrCode";

export type IDKitContext = {
  app_id: `app_${string}`;
  action: string;
  rp_context: RpContext;
};

/**
 * Runs a Selfie Check with the raw hook rather than the packaged widget.
 *
 * `useIDKitRequest` exposes `connectorURI`, `errorCode` and a debug report,
 * which the widget hides behind its own UI. That matters here because the
 * interesting failure — World declining to issue the credential for this app id
 * — surfaces as a specific error code, and the whole point of this page is to
 * show that code verbatim rather than a friendly message.
 */
export function SelfieCheckRunner({
  context,
  signal,
  onResult,
}: {
  context: IDKitContext;
  signal: string;
  onResult?: (result: IDKitResult) => void;
}) {
  const [debugReport, setDebugReport] = useState<string | null>(null);

  useEffect(() => {
    setDebug(true);
  }, []);

  const idkit = useIDKitRequest({
    app_id: context.app_id,
    action: context.action,
    rp_context: context.rp_context,
    allow_legacy_proofs: true,
    preset: selfieCheckLegacy({ signal }),
  });

  useEffect(() => {
    if (idkit.isSuccess && idkit.result) onResult?.(idkit.result);
  }, [idkit.isSuccess, idkit.result, onResult]);

  useEffect(() => {
    if (!idkit.isError) return;
    try {
      setDebugReport(JSON.stringify(idkit.getDebugReport() ?? {}, null, 2));
    } catch {
      setDebugReport(null);
    }
  }, [idkit.isError, idkit]);

  const waiting = idkit.isAwaitingUserConnection || idkit.isAwaitingUserConfirmation;
  const phase = idkit.isSuccess
    ? "verified"
    : idkit.isError
      ? "failed"
      : idkit.isAwaitingUserConfirmation
        ? "awaiting confirmation in World App"
        : idkit.isAwaitingUserConnection
          ? "scan to continue"
          : idkit.isOpen
            ? "starting…"
            : "ready";

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={() => idkit.open()} disabled={idkit.isOpen && !idkit.isError}>
          Verify with Selfie Check
        </button>
        {(idkit.isOpen || idkit.isError) && (
          <button className="btn-secondary font-body font-semibold" onClick={() => idkit.reset()}>
            Reset
          </button>
        )}
        <span className="flex items-center gap-2 text-xs" style={{ opacity: 0.65 }}>
          {waiting && (
            <span
              className="animate-spin-ring h-3.5 w-3.5 flex-none rounded-full"
              style={{
                border: "2px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
                borderTopColor: "var(--color-accent)",
              }}
              aria-hidden
            />
          )}
          {phase}
          {idkit.isInWorldApp && " · inside World App"}
        </span>
      </div>

      {idkit.connectorURI && !idkit.isSuccess && (
        <div className="card elev-sm animate-rise" style={{ padding: 18 }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <QrCode value={idkit.connectorURI} size={190} />
            <div className="min-w-0 flex-1">
              <p className="m-0 font-heading text-[17px]">Scan with World App</p>
              <p className="m-0 mt-1.5 text-[13px]" style={{ opacity: 0.7 }}>
                A link appearing here means World accepted the Selfie Check request for this App ID — the credential is
                enabled. Scan to complete it on your phone.
              </p>
              <p className="kicker mt-3">Connector link</p>
              <p className="mono m-0 mt-1 break-all text-[11px] leading-relaxed" style={{ opacity: 0.6 }}>
                {idkit.connectorURI}
              </p>
            </div>
          </div>
        </div>
      )}

      {idkit.isError && (
        <div
          className="animate-rise rounded-[22px] px-5 py-[18px]"
          style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
        >
          <p className="kicker m-0">Error code</p>
          <p className="mono m-0 mt-1 text-sm font-semibold" style={{ color: "var(--color-accent-700)" }}>
            {idkit.errorCode ?? "unknown"}
          </p>
          <p className="m-0 mt-2 text-xs" style={{ opacity: 0.75 }}>
            <span className="mono">credential_unavailable</span> or <span className="mono">feature_unavailable</span>{" "}
            means this App ID is not entitled to request Selfie Check — that is the server-side gate, and this code is
            what to send to World support. Other codes are ordinary flow failures.
          </p>
          {debugReport && (
            <pre
              className="mono mt-3 max-h-64 overflow-auto rounded-[16px] p-3 text-xs"
              style={{ background: "color-mix(in srgb, var(--color-text) 6%, transparent)", opacity: 0.8 }}
            >
              {debugReport}
            </pre>
          )}
        </div>
      )}

      {idkit.isSuccess && idkit.result && (
        <div
          className="animate-rise rounded-[22px] px-5 py-[18px]"
          style={{ background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)" }}
        >
          <p className="m-0 font-heading text-base">Proof received</p>
          <pre
            className="mono mt-2 max-h-72 overflow-auto rounded-[16px] p-3 text-xs"
            style={{ background: "color-mix(in srgb, var(--color-text) 6%, transparent)", opacity: 0.85 }}
          >
            {JSON.stringify(idkit.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
