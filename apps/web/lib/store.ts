import "server-only";

import type { Hex } from "viem";
import { kvGet, kvSet } from "./kv";
import type { EvidenceFields } from "./commitments";

/**
 * Evidence bundles, keyed by their content hash.
 *
 * A milestone claim on UMA carries a link to /evidence/<hash> and the hash itself.
 * Keying by hash rather than by milestone means a rejected claim's evidence stays
 * readable after the grantee claims again, and the page can prove the bundle it
 * shows is the one that was committed on-chain.
 *
 * Goes through lib/kv — a JSON file locally, Redis in a serverless deployment — so
 * the evidence page resolves wherever the request lands.
 */

const EVIDENCE_KEY = "grantlane:evidence-bundles";

export type EvidenceBundle = EvidenceFields & {
  evidenceHash: Hex;
  /** The URI written into the UMA claim. */
  evidenceURI: string;
};

async function readAll(): Promise<Record<string, EvidenceBundle>> {
  const raw = await kvGet(EVIDENCE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, EvidenceBundle>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function putEvidence(bundle: EvidenceBundle): Promise<void> {
  const all = await readAll();
  all[bundle.evidenceHash.toLowerCase()] = bundle;
  await kvSet(EVIDENCE_KEY, JSON.stringify(all));
}

export async function getEvidence(evidenceHash: Hex): Promise<EvidenceBundle | undefined> {
  return (await readAll())[evidenceHash.toLowerCase()];
}
