import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { hashEvidence, type EvidenceFields } from "@/lib/commitments";
import { getEvidence, putEvidence } from "@/lib/store";
import { readMilestones, STATUS } from "@/lib/contracts";
import { readTicket } from "@/lib/verifications";
import { signMilestoneClaim } from "@/lib/attestor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  grantId?: string;
  milestoneId?: number;
  summary?: string;
  liveUrl?: string;
  demoVideoUrl?: string;
  repoUrl?: string;
  screenshots?: string[];
  /** Signed ticket from /api/verify-selfie with purpose "milestone". */
  verificationTicket?: string;
};

const MIN_SUMMARY = 40;
const MAX_SUMMARY = 4000;
const MAX_SCREENSHOTS = 6;

/** A trimmed http(s) URL, null when empty, or "invalid". */
function httpUrl(value: unknown): string | null | "invalid" {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "invalid";
  } catch {
    return "invalid";
  }
}

function bad(error: string, detail: string, status = 400) {
  return NextResponse.json({ error, detail }, { status });
}

/**
 * Prepares a milestone claim.
 *
 * The grantee sends their evidence and a Selfie Check ticket. The server stores the
 * bundle under its content hash, publishes it at /evidence/<hash> — the URI written
 * into the UMA claim, so a disputer or UMA voter can read exactly what was claimed —
 * and signs the MilestoneClaim attestation GrantEscrow requires. The grantee then
 * posts the bond and sends submitMilestone themselves; the server never holds their
 * key, and the contract checks they are the grantee.
 */
export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("invalid_json", "Request body is not JSON.");
  }

  const { grantId, milestoneId } = body;
  if (!grantId || !/^\d+$/.test(grantId)) return bad("invalid_grant_id", "grantId must be a number.");
  if (typeof milestoneId !== "number" || !Number.isInteger(milestoneId) || milestoneId < 0) {
    return bad("invalid_milestone_id", "milestoneId must be a non-negative integer.");
  }

  // A claim ends in money moving, so it needs a live human behind it.
  const check = readTicket(body.verificationTicket, "milestone");
  if (!check.ok) {
    return bad(
      "human_verification_required",
      check.reason === "expired"
        ? "Your Selfie Check expired. Run it again before claiming."
        : "Complete the Selfie Check before claiming this milestone.",
    );
  }

  // — evidence: specific enough that someone could check it and dispute it —
  const summary = typeof body.summary === "string" ? body.summary.trim() : "";
  if (summary.length < MIN_SUMMARY) {
    return bad("summary_too_short", `Describe what was delivered in at least ${MIN_SUMMARY} characters.`);
  }
  if (summary.length > MAX_SUMMARY) return bad("summary_too_long", `Keep the summary under ${MAX_SUMMARY} characters.`);

  const liveUrl = httpUrl(body.liveUrl);
  const demoVideoUrl = httpUrl(body.demoVideoUrl);
  const repoUrl = httpUrl(body.repoUrl);
  if (liveUrl === "invalid" || demoVideoUrl === "invalid" || repoUrl === "invalid") {
    return bad("invalid_link", "Links must be full http(s) URLs.");
  }
  if (!liveUrl && !demoVideoUrl && !repoUrl) {
    return bad("no_links", "Add at least one link a disputer can check: live product, demo video or repository.");
  }

  const rawShots = Array.isArray(body.screenshots) ? body.screenshots : [];
  if (rawShots.length > MAX_SCREENSHOTS) return bad("too_many_screenshots", `Up to ${MAX_SCREENSHOTS} screenshot links.`);
  const screenshots: string[] = [];
  for (const shot of rawShots) {
    const url = httpUrl(shot);
    if (url === "invalid") return bad("invalid_link", `Not a valid screenshot link: ${String(shot)}`);
    if (url) screenshots.push(url);
  }

  // The contract would revert anyway; checking first saves the grantee a bond approval.
  try {
    const milestones = await readMilestones(BigInt(grantId));
    const milestone = milestones[milestoneId];
    if (!milestone) return bad("unknown_milestone", "This grant has no such milestone.", 404);
    const status = Number(milestone.status);
    if (status !== STATUS.Pending && status !== STATUS.Rejected) {
      return bad("milestone_not_open", "This milestone already has a claim in progress or is paid.", 409);
    }
  } catch (cause) {
    return bad("chain_read_failed", String(cause instanceof Error ? cause.message : cause), 502);
  }

  const fields: EvidenceFields = {
    grantId,
    milestoneId,
    summary,
    liveUrl,
    demoVideoUrl,
    repoUrl,
    screenshots,
    submittedAt: new Date().toISOString(),
  };
  const evidenceHash = hashEvidence(fields);

  // A deployed app should set NEXT_PUBLIC_APP_URL so the claim links to the public
  // address rather than whichever host served this request.
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  const evidenceURI = `${origin}/evidence/${evidenceHash}`;

  await putEvidence({ ...fields, evidenceHash, evidenceURI });

  try {
    const attestation = await signMilestoneClaim({
      grantId: BigInt(grantId),
      milestoneId,
      evidenceHash,
      nullifierHash: check.nullifierHash,
    });
    return NextResponse.json(
      { evidenceHash, evidenceURI, attestation },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    return bad("attestation_failed", String(cause instanceof Error ? cause.message : cause), 500);
  }
}

/** Reads a stored evidence bundle by its hash. */
export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get("hash");
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return bad("invalid_hash", "Pass ?hash=0x… (32 bytes).");
  const bundle = await getEvidence(hash as Hex);
  if (!bundle) return bad("not_found", "No evidence stored under that hash.", 404);
  return NextResponse.json({ bundle }, { headers: { "Cache-Control": "no-store" } });
}
