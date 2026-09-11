import { NextResponse } from "next/server";
import { getApplication, updateApplication, type ProposedMilestone } from "@/lib/applications";
import { hashTerms } from "@/lib/commitments";
import { grantEscrowAddress, readGrant } from "@/lib/contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Patch = {
  action?: "approve" | "decline" | "mark-funded";
  reviewNote?: string;
  approvedMilestones?: ProposedMilestone[];
  /** mark-funded: the milestone set actually passed to createGrant. */
  fundedMilestones?: ProposedMilestone[];
  termsHash?: string;
  grantId?: string;
  fundingTxHash?: string;
};

function cleanMilestones(input: unknown): ProposedMilestone[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((m) => m && typeof m.title === "string" && /^\d+$/.test(String(m.amount)))
    .map((m) => ({
      title: String(m.title).trim(),
      criteria: String(m.criteria ?? "").trim(),
      amount: String(m.amount),
    }))
    .filter((m) => m.title.length > 0 && BigInt(m.amount) > 0n);
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const application = await getApplication(params.id);
  if (!application) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ application }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Reviewer decisions.
 *
 * `approve` records the milestone set the reviewer is willing to fund — which is
 * allowed to differ from what was proposed, since negotiating scope down is the
 * normal outcome of a review. `mark-funded` is called after createGrant lands,
 * to bind the off-chain application to its on-chain grant. It only binds when the
 * milestones it's given hash to the termsHash the grant committed on-chain, so the
 * terms shown next to a grant are provably the terms it was funded under.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const existing = await getApplication(params.id);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let patch: Patch;
  try {
    patch = (await request.json()) as Patch;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (patch.action === "decline") {
    const updated = await updateApplication(params.id, {
      status: "declined",
      reviewNote: patch.reviewNote?.trim() || null,
    });
    return NextResponse.json({ application: updated });
  }

  if (patch.action === "approve") {
    const milestones = cleanMilestones(patch.approvedMilestones);
    if (milestones.length === 0) {
      return NextResponse.json(
        { error: "no_milestones", detail: "Approve at least one milestone with a non-zero amount." },
        { status: 400 },
      );
    }

    const updated = await updateApplication(params.id, {
      status: "approved",
      approvedMilestones: milestones,
      reviewNote: patch.reviewNote?.trim() || null,
    });
    return NextResponse.json({ application: updated });
  }

  if (patch.action === "mark-funded") {
    if (!patch.grantId || !/^\d+$/.test(patch.grantId)) {
      return NextResponse.json({ error: "invalid_grant_id" }, { status: 400 });
    }
    const milestones = cleanMilestones(patch.fundedMilestones);
    if (milestones.length === 0) {
      return NextResponse.json({ error: "no_milestones", detail: "Send the funded milestone set." }, { status: 400 });
    }

    const termsHash = hashTerms(milestones);
    let onChainTerms: string;
    try {
      onChainTerms = (await readGrant(BigInt(patch.grantId))).termsHash;
    } catch (cause) {
      return NextResponse.json(
        { error: "chain_read_failed", detail: String(cause instanceof Error ? cause.message : cause) },
        { status: 502 },
      );
    }
    if (onChainTerms.toLowerCase() !== termsHash.toLowerCase()) {
      return NextResponse.json(
        {
          error: "terms_mismatch",
          detail: `Grant #${patch.grantId} committed terms ${onChainTerms}, but these milestones hash to ${termsHash}.`,
        },
        { status: 409 },
      );
    }

    const updated = await updateApplication(params.id, {
      status: "funded",
      grantId: patch.grantId,
      fundingTxHash: patch.fundingTxHash ?? null,
      approvedMilestones: milestones,
      termsHash,
      escrowAddress: grantEscrowAddress(),
    });
    return NextResponse.json({ application: updated });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
