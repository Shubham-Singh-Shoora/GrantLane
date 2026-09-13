import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { hashDispute, type DisputeFields } from "@/lib/commitments";
import { getDisputeBundle, putDisputeBundle } from "@/lib/store";
import { readMilestones, STATUS } from "@/lib/contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Body = {
  grantId?: string;
  milestoneId?: number;
  reason?: string;
  links?: string[];
};

const MIN_REASON = 40;
const MAX_REASON = 4000;
const MAX_LINKS = 6;

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
 * Prepares a dispute.
 *
 * The disputer explains what is wrong with a live claim. The server stores that
 * explanation under its hash and publishes it at /dispute/<hash>; the disputer then
 * files the dispute through DisputeRegistry, which records the hash and link on-chain
 * in the same transaction as the UMA dispute. Nothing stored here is trusted on its
 * own: the dispute page checks this text against the hash recorded on-chain.
 *
 * The bundle names the exact UMA assertion being disputed, so a reason written about
 * one claim can't be passed off as a reason against a later one.
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

  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < MIN_REASON) {
    return bad("reason_too_short", `Explain what is wrong with the claim in at least ${MIN_REASON} characters.`);
  }
  if (reason.length > MAX_REASON) return bad("reason_too_long", `Keep the reason under ${MAX_REASON} characters.`);

  const rawLinks = Array.isArray(body.links) ? body.links : [];
  if (rawLinks.length > MAX_LINKS) return bad("too_many_links", `Up to ${MAX_LINKS} links.`);
  const links: string[] = [];
  for (const link of rawLinks) {
    const url = httpUrl(link);
    if (url === "invalid") return bad("invalid_link", `Not a valid link: ${String(link)}`);
    if (url) links.push(url);
  }

  // Only a live claim inside its window can be disputed; checking here saves the
  // disputer a bond approval that UMA would refuse anyway.
  let assertionId: Hex;
  try {
    const milestone = (await readMilestones(BigInt(grantId)))[milestoneId];
    if (!milestone) return bad("unknown_milestone", "This grant has no such milestone.", 404);
    if (Number(milestone.status) !== STATUS.Claimed) {
      return bad("not_disputable", "This milestone has no live claim to dispute.", 409);
    }
    if (Number(milestone.expiresAt) <= Math.floor(Date.now() / 1000)) {
      return bad("window_closed", "The dispute window for this claim has closed.", 409);
    }
    assertionId = milestone.assertionId;
  } catch (cause) {
    return bad("chain_read_failed", String(cause instanceof Error ? cause.message : cause), 502);
  }

  const fields: DisputeFields = {
    grantId,
    milestoneId,
    assertionId,
    reason,
    links,
    submittedAt: new Date().toISOString(),
  };
  const reasonHash = hashDispute(fields);

  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin).replace(/\/$/, "");
  const reasonURI = `${origin}/dispute/${reasonHash}`;

  await putDisputeBundle({ ...fields, reasonHash, reasonURI });

  return NextResponse.json({ reasonHash, reasonURI }, { headers: { "Cache-Control": "no-store" } });
}

/** Reads a stored dispute reason by its hash. */
export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get("hash");
  if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) return bad("invalid_hash", "Pass ?hash=0x… (32 bytes).");
  const bundle = await getDisputeBundle(hash as Hex);
  if (!bundle) return bad("not_found", "No dispute stored under that hash.", 404);
  return NextResponse.json({ bundle }, { headers: { "Cache-Control": "no-store" } });
}
