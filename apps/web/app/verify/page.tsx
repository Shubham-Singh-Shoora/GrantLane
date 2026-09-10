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
    <div className="animate-rise">
      <div className="pb-5 pt-6">
        <p className="card-kicker m-0">World ID</p>
        <h1 className="mb-2 mt-1 text-[40px]">Selfie Check</h1>
        <p className="m-0 max-w-[58ch] text-[15px]" style={{ opacity: 0.7 }}>
          Proves a live human without revealing who they are. GrantLane uses it to gate changing a grant&apos;s payout
          wallet — the step an attacker would take after stealing a session.
        </p>
      </div>

      {contextError && (
        <div
          className="rounded-[22px] px-5 py-[18px]"
          style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
        >
          <p className="m-0 font-heading text-base">Could not build a request context</p>
          <p className="m-0 mt-1.5 text-sm" style={{ opacity: 0.85 }}>
            {contextError}
          </p>
          <p className="m-0 mt-2 text-xs" style={{ opacity: 0.65 }}>
            This is a server-side failure before World is contacted — check <span className="mono">WORLD_RP_ID</span>{" "}
            and <span className="mono">WORLD_RP_SIGNING_KEY</span> in .env.
          </p>
          <button className="btn-secondary mt-3 font-body font-semibold" onClick={() => void loadContext()}>
            Retry
          </button>
        </div>
      )}

      {context && (
        <div className="flex flex-col gap-4">
          <div className="card elev-sm" style={{ padding: 20 }}>
            <dl className="grid gap-3.5 sm:grid-cols-3">
              <div className="min-w-0">
                <dt className="kicker">App ID</dt>
                <dd className="mono m-0 mt-0.5 truncate text-xs" title={context.app_id}>
                  {context.app_id}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="kicker">RP ID</dt>
                <dd className="mono m-0 mt-0.5 truncate text-xs">{context.rp_context.rp_id}</dd>
              </div>
              <div className="min-w-0">
                <dt className="kicker">Action</dt>
                <dd className="mono m-0 mt-0.5 truncate text-xs">{context.action}</dd>
              </div>
            </dl>
            <p className="m-0 mt-3 text-xs" style={{ opacity: 0.6 }}>
              Request context signed server-side, valid for{" "}
              {context.rp_context.expires_at - context.rp_context.created_at}s.
            </p>
          </div>

          <SelfieCheckRunner context={context} signal="grantlane-standalone" onResult={onResult} />
        </div>
      )}

      {verifyResponse && (
        <div className="card elev-sm mt-4" style={{ padding: 20 }}>
          <p className="kicker m-0">Server verification response</p>
          <pre
            className="mono mt-2 max-h-72 overflow-auto rounded-[16px] p-3 text-xs"
            style={{ background: "color-mix(in srgb, var(--color-text) 6%, transparent)", opacity: 0.85 }}
          >
            {verifyResponse}
          </pre>
        </div>
      )}
    </div>
  );
}
