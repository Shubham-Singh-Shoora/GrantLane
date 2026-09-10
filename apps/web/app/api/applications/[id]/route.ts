import { NextResponse } from "next/server";
import { getApplication, updateApplication, type ProposedMilestone } from "@/lib/applications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Patch = {
  action?: "approve" | "decline" | "mark-funded";
  reviewNote?: string;
  approvedMilestones?: ProposedMilestone[];
  grantId?: string;
  fundingTxHash?: string;
};

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
 * to bind the off-chain application to its on-chain grant id.
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
    const milestones = (patch.approvedMilestones ?? [])
      .filter((m) => m && typeof m.title === "string" && /^\d+$/.test(String(m.amount)))
      .map((m) => ({
        title: String(m.title).trim(),
        criteria: String(m.criteria ?? "").trim(),
        amount: String(m.amount),
      }))
      .filter((m) => m.title.length > 0 && BigInt(m.amount) > 0n);

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
    const updated = await updateApplication(params.id, {
      status: "funded",
      grantId: patch.grantId,
      fundingTxHash: patch.fundingTxHash ?? null,
    });
    return NextResponse.json({ application: updated });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}
