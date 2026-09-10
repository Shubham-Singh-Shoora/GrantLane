"use client";

import { useCallback, useEffect, useState } from "react";
import type { IDKitResult } from "@worldcoin/idkit-core";
import { SelfieCheckRunner, type IDKitContext } from "@/components/SelfieCheckRunner";

/**
 * Standalone Selfie Check page.
 *
 * Two jobs. It is the entry point for proving humanness outside a grant, and it
 * is the diagnostic for whether this App ID is entitled to request the Selfie
 * Check credential at all — that gate is server-side at World, so the only way
 * to know is to ask and read the error code.
 */
export default function VerifyPage() {
  const [context, setContext] = useState<IDKitContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [verifyResponse, setVerifyResponse] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    setContextError(null);
    try {
      const response = await fetch("/api/idkit-context", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) {
        setContextError(body.detail ?? body.error ?? "Could not build an IDKit request context.");
        return;
      }
      setContext(body as IDKitContext);
    } catch (cause) {
      setContextError(String(cause));
    }
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  // Send whatever comes back to the server so the backend verification path is
  // exercised too, not just the client handshake.
  const onResult = useCallback(async (result: IDKitResult) => {
    try {
      const response = await fetch("/api/verify-selfie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ result, grantId: "0", newWallet: "0x0000000000000000000000000000000000000001" }),
      });
      setVerifyResponse(JSON.stringify(await response.json(), null, 2));
    } catch (cause) {
      setVerifyResponse(String(cause));
    }
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Selfie Check</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Proves a live human without revealing who they are. GrantLane uses it to gate changing a
          grant&apos;s payout wallet — the step an attacker would take after stealing a session.
        </p>
      </div>

      {contextError && (
        <div className="panel border-danger/40 p-4">
          <p className="label text-danger">Could not build a request context</p>
          <p className="mt-1 text-sm text-slate-300">{contextError}</p>
          <p className="mt-2 text-xs text-muted">
            This is a server-side failure before World is contacted — check WORLD_RP_ID and
            WORLD_RP_SIGNING_KEY in .env.
          </p>
          <button className="btn-ghost mt-3" onClick={() => void loadContext()}>
            Retry
          </button>
        </div>
      )}

      {context && (
        <>
          <div className="panel p-4">
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="label">App ID</dt>
                <dd className="truncate font-mono text-xs text-slate-200" title={context.app_id}>
                  {context.app_id}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="label">RP ID</dt>
                <dd className="truncate font-mono text-xs text-slate-200">{context.rp_context.rp_id}</dd>
              </div>
              <div className="min-w-0">
                <dt className="label">Action</dt>
                <dd className="truncate font-mono text-xs text-slate-200">{context.action}</dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-muted">
              Request context signed server-side, valid for{" "}
              {context.rp_context.expires_at - context.rp_context.created_at}s.
            </p>
          </div>

          <SelfieCheckRunner context={context} signal="grantlane-standalone" onResult={onResult} />
        </>
      )}

      {verifyResponse && (
        <div className="panel p-4">
          <p className="label">Server verification response</p>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-ink p-3 text-xs text-muted">{verifyResponse}</pre>
        </div>
      )}
    </div>
  );
}
