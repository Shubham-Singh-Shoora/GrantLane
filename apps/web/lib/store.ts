import "server-only";

import type { Hex } from "viem";
import { kvGet, kvSet } from "./kv";

/**
 * Evidence and execution bookkeeping.
 *
 * The authoritative state of a grant lives on Arc and the authoritative state of
 * a scoring run lives in CRE. What is kept here is the join between the two —
 * which execution was started for which milestone, and the evidence bundle the
 * enclave fetches back over confidential HTTP.
 *
 * This used to be an in-memory Map. That breaks in a serverless deployment for a
 * reason worth spelling out: the CRE workflow calls back into /api/milestones to
 * read the bundle, and that request can land on a different instance than the
 * one that stored it — so the enclave would find nothing and silently score the
 * triggered payload instead of the authoritative bundle. Going through lib/kv
 * makes the read reliable wherever it lands.
 */

const EVIDENCE_KEY = "grantlane:evidence";
const EXECUTIONS_KEY = "grantlane:executions";

export type EvidenceBundle = {
  grantId: string;
  milestoneId: number;
  /** Free-form evidence the workflow scores: links, notes, metrics. */
  summary: string;
  artifacts: string[];
  submittedAt: string;
  /** keccak256 of the canonical bundle, mirrored on-chain by submitEvidence. */
  evidenceHash: Hex;
};

export type ExecutionRecord = {
  executionId: string;
  grantId: string;
  milestoneId: number;
  status: "pending" | "running" | "succeeded" | "failed";
  startedAt: string;
  updatedAt: string;
  /** Set once the workflow reports back or the receipt is observed on-chain. */
  txHash?: Hex;
  scoreBps?: number;
  approved?: boolean;
  error?: string;
};

function key(grantId: string, milestoneId: number): string {
  return `${grantId}:${milestoneId}`;
}

async function readMap<T>(storeKey: string): Promise<Record<string, T>> {
  const raw = await kvGet(storeKey);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, T>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function writeMap<T>(storeKey: string, value: Record<string, T>): Promise<void> {
  await kvSet(storeKey, JSON.stringify(value));
}

export async function putEvidence(bundle: EvidenceBundle): Promise<void> {
  const all = await readMap<EvidenceBundle>(EVIDENCE_KEY);
  all[key(bundle.grantId, bundle.milestoneId)] = bundle;
  await writeMap(EVIDENCE_KEY, all);
}

export async function getEvidence(grantId: string, milestoneId: number): Promise<EvidenceBundle | undefined> {
  const all = await readMap<EvidenceBundle>(EVIDENCE_KEY);
  return all[key(grantId, milestoneId)];
}

export async function putExecution(record: ExecutionRecord): Promise<void> {
  const all = await readMap<ExecutionRecord>(EXECUTIONS_KEY);
  all[record.executionId] = record;
  await writeMap(EXECUTIONS_KEY, all);
}

export async function getExecution(executionId: string): Promise<ExecutionRecord | undefined> {
  const all = await readMap<ExecutionRecord>(EXECUTIONS_KEY);
  return all[executionId];
}

export async function updateExecution(
  executionId: string,
  patch: Partial<ExecutionRecord>,
): Promise<ExecutionRecord | undefined> {
  const all = await readMap<ExecutionRecord>(EXECUTIONS_KEY);
  const existing = all[executionId];
  if (!existing) return undefined;

  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  all[executionId] = next;
  await writeMap(EXECUTIONS_KEY, all);
  return next;
}

export async function listExecutionsForGrant(grantId: string): Promise<ExecutionRecord[]> {
  const all = await readMap<ExecutionRecord>(EXECUTIONS_KEY);
  return Object.values(all)
    .filter((e) => e.grantId === grantId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function latestExecutionFor(grantId: string, milestoneId: number): Promise<ExecutionRecord | undefined> {
  return (await listExecutionsForGrant(grantId)).find((e) => e.milestoneId === milestoneId);
}
