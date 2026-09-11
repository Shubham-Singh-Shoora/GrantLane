import { NextResponse } from "next/server";
import type { IDKitResult } from "@worldcoin/idkit-core";
import { isAddress, type Address } from "viem";
import { isWorldPurpose, resultCarriesSelfieCredential, verifyIDKitResult, type WorldPurpose } from "@/lib/world";
import { signPayoutWalletChange } from "@/lib/attestor";
import { issueTicket } from "@/lib/verifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  result?: IDKitResult;
  purpose?: string;
  grantId?: string;
  newWallet?: string;
};

/**
 * Verifies a Selfie Check proof server-side, and — for a payout-wallet change —
 * issues the EIP-712 attestation that authorises it on-chain.
 *
 * The proof is checked here rather than in the browser: a client-side check
 * would be trivially bypassed, and for the payout purpose this endpoint is what
 * stands between a stolen session and a redirected grant payout.
 *
 * For the `application` and `milestone` purposes the caller gets back a signed
 * ticket carrying the nullifier. An application ticket is spent by
 * /api/applications, which refuses a second submission from the same person; a
 * milestone ticket is spent by /api/milestones, which exchanges it for the
 * on-chain claim attestation.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { result, grantId, newWallet } = body;
  const purpose: WorldPurpose = isWorldPurpose(body.purpose) ? body.purpose : "payout-wallet";

  if (!result || typeof result !== "object") {
    return NextResponse.json({ error: "missing_result" }, { status: 400 });
  }

  if (!resultCarriesSelfieCredential(result)) {
    return NextResponse.json(
      {
        error: "wrong_credential",
        detail: "Proof did not include the 'selfie' credential. Use the selfieCheckLegacy preset.",
      },
      { status: 400 },
    );
  }

  const outcome = await verifyIDKitResult(result);
  if (!outcome.ok) {
    return NextResponse.json({ error: outcome.code, detail: outcome.detail }, { status: 400 });
  }

  // Proof-of-humanity only — used to gate an application or a milestone submit.
  //
  // A signed ticket rather than a bare nullifier: the endpoint that consumes it
  // has to be able to tell a verified nullifier from 32 bytes a script invented,
  // and it cannot re-check the proof itself.
  if (purpose !== "payout-wallet") {
    return NextResponse.json(
      {
        verified: true,
        purpose,
        ticket: issueTicket(purpose, outcome.nullifierHash),
        action: outcome.action,
        environment: outcome.environment,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Payout-wallet change — the proof buys an on-chain authorisation, so the
  // extra arguments are required and validated here.
  if (!grantId || !/^\d+$/.test(grantId)) {
    return NextResponse.json({ error: "invalid_grant_id" }, { status: 400 });
  }
  if (!newWallet || !isAddress(newWallet)) {
    return NextResponse.json({ error: "invalid_wallet" }, { status: 400 });
  }

  try {
    const attestation = await signPayoutWalletChange({
      grantId: BigInt(grantId),
      newWallet: newWallet as Address,
      nullifierHash: outcome.nullifierHash,
    });

    return NextResponse.json(
      { verified: true, purpose, nullifierHash: outcome.nullifierHash, attestation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return NextResponse.json(
      { error: "attestation_failed", detail: String(cause instanceof Error ? cause.message : cause) },
      { status: 500 },
    );
  }
}
