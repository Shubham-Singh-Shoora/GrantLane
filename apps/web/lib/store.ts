import "server-only";

import type { Hex } from "viem";

/**
 * Evidence and execution bookkeeping.
 *
 * Deliberately in-memory: the authoritative state of a grant lives on Arc, and
 * the authoritative state of a scoring run lives in CRE. What is kept here is
 * only the join between the two — which execution was started for which
 * milestone, and where its evidence bundle can be fetched — so the UI can show
 * "scoring in progress" between the submit transaction and the report landing.
 *
 * Swap this for Postgres/Redis before anything but a demo: a serverless deploy
 * runs multiple isolates and this map is per-isolate.
 */

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

// Survives hot reload in dev, where module state would otherwise reset.
const globalStore = globalThis as unknown as {
  __grantlaneEvidence?: Map<string, EvidenceBundle>;
  __grantlaneExecutions?: Map<string, ExecutionRecord>;
};

const evidence = (globalStore.__grantlaneEvidence ??= new Map<string, EvidenceBundle>());
const executions = (globalStore.__grantlaneExecutions ??= new Map<string, ExecutionRecord>());

export function putEvidence(bundle: EvidenceBundle): void {
  evidence.set(key(bundle.grantId, bundle.milestoneId), bundle);
}

export function getEvidence(grantId: string, milestoneId: number): EvidenceBundle | undefined {
  return evidence.get(key(grantId, milestoneId));
}

export function putExecution(record: ExecutionRecord): void {
  executions.set(record.executionId, record);
}

export function getExecution(executionId: string): ExecutionRecord | undefined {
  return executions.get(executionId);
}

export function updateExecution(executionId: string, patch: Partial<ExecutionRecord>): ExecutionRecord | undefined {
  const existing = executions.get(executionId);
  if (!existing) return undefined;
  const next = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  executions.set(executionId, next);
  return next;
}

export function listExecutionsForGrant(grantId: string): ExecutionRecord[] {
  return [...executions.values()]
    .filter((e) => e.grantId === grantId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function latestExecutionFor(grantId: string, milestoneId: number): ExecutionRecord | undefined {
  return listExecutionsForGrant(grantId).find((e) => e.milestoneId === milestoneId);
}
