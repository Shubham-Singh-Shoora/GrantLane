import { NextResponse } from "next/server";
import { buildRpContext, worldAction, worldAppId } from "@/lib/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hands the browser a freshly signed IDKit request context.
 *
 * IDKit 4.x requires `rp_context` — an ECDSA signature over the request nonce
 * and validity window made with the Relying Party key. That key is server-side
 * only, so the client cannot build this itself. Contexts are short-lived; the
 * client fetches one immediately before opening the widget.
 */
export async function GET() {
  try {
    const action = worldAction();
    return NextResponse.json(
      {
        app_id: worldAppId(),
        action,
        rp_context: buildRpContext(action),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return NextResponse.json(
      { error: "idkit_context_unavailable", detail: String(cause instanceof Error ? cause.message : cause) },
      { status: 500 },
    );
  }
}
