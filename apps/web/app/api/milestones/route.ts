import { NextResponse } from "next/server";
import { hashEvidence, startEvaluation } from "@/lib/cre";
import { getEvidence, latestExecutionFor, putEvidence, type EvidenceBundle } from "@/lib/store";
import { readMilestones } from "@/lib/contracts";
import { readTicket } from "@/lib/verifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  grantId?: string;
  milestoneId?: number;
  summary?: string;
  artifacts?: string[];
  /** Signed ticket from /api/verify-selfie with purpose "milestone". */
  verificationTicket?: string;
};

/**
 * Accepts a milestone evidence bundle, hashes it, and starts a CRE scoring run.
 *
 * The hash is returned so the grantee can mirror it on-chain with
 * `submitEvidence(grantId, milestoneId, evidenceHash)` — that transaction is
 * what moves the milestone into `Submitted` and makes it eligible for a report.
 * The server never holds the grantee's key, so it cannot send that transaction.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { grantId, milestoneId, summary, artifacts } = body;

  if (!grantId || !/^\d+$/.test(grantId)) {
    return NextResponse.json({ error: "invalid_grant_id" }, { status: 400 });
  }
  if (typeof milestoneId !== "number" || !Number.isInteger(milestoneId) || milestoneId < 0) {
    return NextResponse.json({ error: "invalid_milestone_id" }, { status: 400 });
  }
  if (typeof summary !== "string" || summary.trim().length === 0) {
    return NextResponse.json({ error: "missing_summary" }, { status: 400 });
  }

  // A milestone claim ends in money moving, so it gets the same treatment as an
  // application: a server-signed ticket proving a live human made this claim.
  const check = readTicket(body.verificationTicket, "milestone");
  if (!check.ok) {
    return NextResponse.json(
      {
        error: "human_verification_required",
        detail:
          check.reason === "expired"
            ? "Your Selfie Check expired. Run it again before submitting."
            : "Complete the Selfie Check before claiming this milestone.",
      },
      { status: 400 },
    );
  }

  const draft = {
    grantId,
    milestoneId,
    summary: summary.trim(),
    artifacts: Array.isArray(artifacts) ? artifacts.filter((a) => typeof a === "string") : [],
    submittedAt: new Date().toISOString(),
  };

  const bundle: EvidenceBundle = { ...draft, evidenceHash: hashEvidence(draft) };
  await putEvidence(bundle);

  // The workflow needs to know what this milestone still owes, and the chain is
  // the only authority on that.
  let payoutAmount: bigint;
  try {
    const milestones = await readMilestones(BigInt(grantId));
    const milestone = milestones[milestoneId];
    if (!milestone) {
      return NextResponse.json({ error: "unknown_milestone" }, { status: 404 });
    }
    payoutAmount = milestone.amount - milestone.paidAmount;
  } catch (cause) {
    return NextResponse.json(
      { error: "chain_read_failed", detail: String(cause instanceof Error ? cause.message : cause) },
      { status: 502 },
    );
  }

  const execution = await startEvaluation({ grantId, milestoneId, evidence: bundle, payoutAmount });

  return NextResponse.json(
    { evidenceHash: bundle.evidenceHash, bundle, execution },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Reads back a stored bundle and its most recent scoring run. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const grantId = url.searchParams.get("grantId");
  const milestoneId = Number(url.searchParams.get("milestoneId"));

  if (!grantId || !/^\d+$/.test(grantId) || !Number.isInteger(milestoneId) || milestoneId < 0) {
    return NextResponse.json({ error: "invalid_params" }, { status: 400 });
  }

  return NextResponse.json(
    {
      bundle: (await getEvidence(grantId, milestoneId)) ?? null,
      execution: (await latestExecutionFor(grantId, milestoneId)) ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
