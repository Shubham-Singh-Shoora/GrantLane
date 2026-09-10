import { NextResponse } from "next/server";
import { isAddress } from "viem";
import {
  createApplication,
  findByNullifier,
  listApplications,
  type ProposedMilestone,
} from "@/lib/applications";
import { fetchRepoSnapshot } from "@/lib/github";
import { readTicket } from "@/lib/verifications";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  projectName?: string;
  organisation?: string;
  pitch?: string;
  website?: string;
  repoUrl?: string;
  wallet?: string;
  proposedMilestones?: ProposedMilestone[];
  /** Signed ticket from /api/verify-selfie with purpose "application". */
  verificationTicket?: string;
};

export async function GET() {
  return NextResponse.json({ applications: await listApplications() }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Accepts a grant application.
 *
 * Proof of humanity is required, not optional: without it this endpoint is a
 * free-for-all a script can flood. The nullifier is scoped to the application
 * action by World, is verified server-side before it reaches here, and is
 * single-use — one human, one open application.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const projectName = body.projectName?.trim();
  const organisation = body.organisation?.trim();
  const pitch = body.pitch?.trim();
  const wallet = body.wallet?.trim();

  if (!projectName) return NextResponse.json({ error: "missing_project_name" }, { status: 400 });
  if (!pitch || pitch.length < 40) {
    return NextResponse.json(
      { error: "pitch_too_short", detail: "Give the reviewer at least a couple of sentences." },
      { status: 400 },
    );
  }
  if (!wallet || !isAddress(wallet)) {
    return NextResponse.json({ error: "invalid_wallet" }, { status: 400 });
  }

  // The ticket is the proof, not the nullifier inside it. Anyone can invent a
  // 32-byte hex string; only this server can sign one.
  const check = readTicket(body.verificationTicket, "application");
  if (!check.ok) {
    return NextResponse.json(
      {
        error: "human_verification_required",
        detail:
          check.reason === "expired"
            ? "Your Selfie Check expired. Run it again."
            : "Complete the Selfie Check before submitting.",
      },
      { status: 400 },
    );
  }

  const nullifierHash = check.nullifierHash;
  if (await findByNullifier(nullifierHash)) {
    return NextResponse.json(
      { error: "already_applied", detail: "This World ID has already submitted an application." },
      { status: 409 },
    );
  }

  const milestones = (body.proposedMilestones ?? [])
    .filter((m) => m && typeof m.title === "string" && /^\d+$/.test(String(m.amount)))
    .map((m) => ({
      title: String(m.title).trim(),
      criteria: String(m.criteria ?? "").trim(),
      amount: String(m.amount),
    }))
    .filter((m) => m.title.length > 0 && BigInt(m.amount) > 0n);

  if (milestones.length === 0) {
    return NextResponse.json(
      { error: "no_milestones", detail: "Propose at least one milestone with an amount." },
      { status: 400 },
    );
  }

  // Snapshot the repo now so the reviewer sees the state at submission time,
  // not whatever it looks like whenever they happen to open the application.
  let repo = null;
  if (body.repoUrl?.trim()) {
    const lookup = await fetchRepoSnapshot(body.repoUrl.trim());
    if (!lookup.ok) {
      return NextResponse.json({ error: lookup.code, detail: lookup.detail }, { status: 400 });
    }
    repo = lookup.snapshot;
  }

  const requestedAmount = milestones.reduce((sum, m) => sum + BigInt(m.amount), 0n).toString();

  const application = await createApplication({
    projectName,
    organisation: organisation ?? "",
    pitch,
    website: body.website?.trim() || null,
    repoUrl: body.repoUrl?.trim() || null,
    repo,
    wallet,
    requestedAmount,
    proposedMilestones: milestones,
    humanVerified: true,
    nullifierHash: nullifierHash as `0x${string}`,
    verifiedAt: new Date().toISOString(),
  });

  return NextResponse.json({ application }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
