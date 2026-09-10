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

  const phase = idkit.isSuccess
    ? "success"
    : idkit.isError
      ? "error"
      : idkit.isAwaitingUserConfirmation
        ? "awaiting confirmation in World App"
        : idkit.isAwaitingUserConnection
          ? "awaiting connection — scan the link below"
          : idkit.isOpen
            ? "starting…"
            : "idle";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={() => idkit.open()} disabled={idkit.isOpen && !idkit.isError}>
          Run Selfie Check
        </button>
        <button className="btn-ghost" onClick={() => idkit.reset()}>
          Reset
        </button>
        <span className="text-xs text-muted">
          status: <span className="text-slate-200">{phase}</span>
          {idkit.isInWorldApp && " · running inside World App"}
        </span>
      </div>

      {idkit.connectorURI && (
        <div className="panel p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <QrCode value={idkit.connectorURI} size={200} />
            <div className="min-w-0 flex-1">
              <p className="label">Scan with World App</p>
              <p className="mt-1 text-xs text-muted">
                A link appearing here means World accepted the Selfie Check request for this App ID —
                the credential is enabled. Scan to complete it on your phone.
              </p>
              <p className="mt-3 label">Connector link</p>
              <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-slate-400">
                {idkit.connectorURI}
              </p>
            </div>
          </div>
        </div>
      )}

      {idkit.isError && (
        <div className="panel border-danger/40 p-4">
          <p className="label text-danger">Error code</p>
          <p className="mt-1 font-mono text-sm text-danger">{idkit.errorCode ?? "unknown"}</p>
          <p className="mt-2 text-xs text-muted">
            <span className="text-slate-300">credential_unavailable</span> or{" "}
            <span className="text-slate-300">feature_unavailable</span> means this app id is not
            entitled to request Selfie Check — that is the server-side gate, and this code is what to
            send to World support. Other codes are ordinary flow failures.
          </p>
          {debugReport && (
            <pre className="mt-3 max-h-64 overflow-auto rounded-md bg-ink p-3 text-xs text-muted">{debugReport}</pre>
          )}
        </div>
      )}

      {idkit.isSuccess && idkit.result && (
        <div className="panel border-accent/40 p-4">
          <p className="label text-accent">Proof received</p>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-ink p-3 text-xs text-muted">
            {JSON.stringify(idkit.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
