import { NextResponse } from "next/server";
import type { IDKitResult } from "@worldcoin/idkit-core";
import { isAddress, type Address } from "viem";
import { resultCarriesSelfieCredential, verifyIDKitResult } from "@/lib/world";
import { signPayoutWalletChange } from "@/lib/attestor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  result?: IDKitResult;
  grantId?: string;
  newWallet?: string;
};

/**
 * Verifies a Selfie Check proof and, if it holds, issues an EIP-712 attestation
 * that lets the grantee repoint their payout wallet on-chain.
 *
 * The proof is checked here rather than in the browser: a client-side check
 * would be trivially bypassed, and this endpoint is what stands between a
 * stolen session and a redirected grant payout.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { result, grantId, newWallet } = body;

  if (!result || typeof result !== "object") {
    return NextResponse.json({ error: "missing_result" }, { status: 400 });
  }
  if (!grantId || !/^\d+$/.test(grantId)) {
    return NextResponse.json({ error: "invalid_grant_id" }, { status: 400 });
  }
  if (!newWallet || !isAddress(newWallet)) {
    return NextResponse.json({ error: "invalid_wallet" }, { status: 400 });
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

  try {
    const attestation = await signPayoutWalletChange({
      grantId: BigInt(grantId),
      newWallet: newWallet as Address,
      nullifierHash: outcome.nullifierHash,
    });

    return NextResponse.json(
      { verified: true, attestation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return NextResponse.json(
      { error: "attestation_failed", detail: String(cause instanceof Error ? cause.message : cause) },
      { status: 500 },
    );
  }
}
