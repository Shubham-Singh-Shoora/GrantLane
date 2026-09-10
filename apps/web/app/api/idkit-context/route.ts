import { NextResponse } from "next/server";
import { buildRpContext, isWorldPurpose, worldAction, worldAppId } from "@/lib/world";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Hands the browser a freshly signed IDKit request context.
 *
 * IDKit 4.x requires `rp_context` — an ECDSA signature over the request nonce
 * and validity window made with the Relying Party key. That key is server-side
 * only, so the client cannot build this itself. Contexts are short-lived; the
 * client fetches one immediately before opening IDKit.
 *
 * `?purpose=` selects which action to sign for. The purpose is validated against
 * an allowlist rather than passed through, so a caller cannot mint a context for
 * an arbitrary action of their choosing.
 */
export async function GET(request: Request) {
  try {
    const purposeParam = new URL(request.url).searchParams.get("purpose");
    if (purposeParam !== null && !isWorldPurpose(purposeParam)) {
      return NextResponse.json({ error: "unknown_purpose", detail: `Unknown purpose "${purposeParam}".` }, { status: 400 });
    }

    const purpose = purposeParam ?? "payout-wallet";
    const action = worldAction(purpose);

    return NextResponse.json(
      {
        app_id: worldAppId(),
        action,
        purpose,
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
