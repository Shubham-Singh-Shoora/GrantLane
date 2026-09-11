import { keccak256, toHex, type Hex } from "viem";

/**
 * The two things a UMA claim is judged by, reduced to hashes the chain can hold.
 *
 * Terms: createGrant commits keccak256 of the funded milestone set, so the grantor
 * can't quietly rewrite what a milestone required after the fact. Evidence:
 * submitMilestone commits keccak256 of the bundle, so the grantee can't swap it
 * after a disputer has read it. Both are canonical JSON with a fixed key order —
 * anyone holding the same content gets the same hash.
 */

export type TermsMilestone = { title: string; criteria: string; amount: string };

export function canonicalTerms(milestones: TermsMilestone[]): string {
  return JSON.stringify({
    version: 1,
    milestones: milestones.map((m) => ({ title: m.title, criteria: m.criteria, amount: m.amount })),
  });
}

export function hashTerms(milestones: TermsMilestone[]): Hex {
  return keccak256(toHex(canonicalTerms(milestones)));
}

export type EvidenceFields = {
  grantId: string;
  milestoneId: number;
  summary: string;
  liveUrl: string | null;
  demoVideoUrl: string | null;
  repoUrl: string | null;
  screenshots: string[];
  submittedAt: string;
};

export function canonicalEvidence(e: EvidenceFields): string {
  return JSON.stringify({
    version: 1,
    grantId: e.grantId,
    milestoneId: e.milestoneId,
    summary: e.summary,
    liveUrl: e.liveUrl,
    demoVideoUrl: e.demoVideoUrl,
    repoUrl: e.repoUrl,
    screenshots: e.screenshots,
    submittedAt: e.submittedAt,
  });
}

export function hashEvidence(e: EvidenceFields): Hex {
  return keccak256(toHex(canonicalEvidence(e)));
}
