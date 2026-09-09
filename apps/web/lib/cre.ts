import "server-only";

import { keccak256, toHex, type Hex } from "viem";
import { putExecution, updateExecution, type EvidenceBundle, type ExecutionRecord } from "./store";

/**
 * Client for the grant-evaluation CRE workflow.
 *
 * The workflow is fronted by an HTTP trigger (see cre-workflow/grant-evaluation-workflow).
 * Posting the evidence bundle starts a run; the run scores the evidence inside a
 * TEE, then writes a DON-signed report to GrantEscrow on Arc. This module owns
 * the request/response shape on the web side of that boundary.
 *
 * NOTE ON STATUS POLLING: CRE does not expose a stable public REST endpoint for
 * reading an execution by id at the time of writing. `fetchExecutionStatus`
 * therefore reports what this server knows locally, and treats the on-chain
 * milestone state as the source of truth for completion. If/when a status API is
 * available, point CRE_STATUS_URL at it and this function will prefer it.
 */

export type EvaluationRequest = {
  grantId: string;
  milestoneId: number;
  evidence: EvidenceBundle;
  /**
   * Milestone balance still owed, in USDC base units, read from the chain here
   * so the workflow does not have to ABI-decode a dynamic struct array. Not a
   * trust boundary: GrantEscrow reverts on any payout above the remaining
   * balance, so an inflated value cannot over-pay.
   */
  payoutAmount: bigint;
};

function triggerUrl(): string | undefined {
  return process.env.CRE_TRIGGER_URL;
}

function statusUrl(): string | undefined {
  return process.env.CRE_STATUS_URL;
}

/** Canonical hash of an evidence bundle — mirrored on-chain by submitEvidence. */
export function hashEvidence(bundle: Omit<EvidenceBundle, "evidenceHash">): Hex {
  const canonical = JSON.stringify({
    grantId: bundle.grantId,
    milestoneId: bundle.milestoneId,
    summary: bundle.summary,
    artifacts: [...bundle.artifacts].sort(),
    submittedAt: bundle.submittedAt,
  });
  return keccak256(toHex(canonical));
}

/**
 * Starts a scoring run and records it locally.
 *
 * When CRE_TRIGGER_URL is unset the run is recorded as `pending` with a local
 * id, so the UI is still exercisable before the workflow is deployed.
 */
export async function startEvaluation(request: EvaluationRequest): Promise<ExecutionRecord> {
  const startedAt = new Date().toISOString();
  const url = triggerUrl();

  const base: ExecutionRecord = {
    executionId: `local-${request.grantId}-${request.milestoneId}-${Date.now()}`,
    grantId: request.grantId,
    milestoneId: request.milestoneId,
    status: "pending",
    startedAt,
    updatedAt: startedAt,
  };

  if (!url) {
    const record: ExecutionRecord = {
      ...base,
      error: "CRE_TRIGGER_URL is not set; evidence stored but no workflow run started.",
    };
    putExecution(record);
    return record;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.CRE_TRIGGER_AUTH ? { Authorization: process.env.CRE_TRIGGER_AUTH } : {}),
      },
      body: JSON.stringify({
        grantId: request.grantId,
        milestoneId: request.milestoneId,
        evidence: request.evidence,
        payoutAmount: request.payoutAmount.toString(),
      }),
      cache: "no-store",
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const record: ExecutionRecord = {
        ...base,
        status: "failed",
        error: `Trigger returned ${response.status}: ${JSON.stringify(body).slice(0, 300)}`,
      };
      putExecution(record);
      return record;
    }

    const executionId =
      typeof body.executionId === "string"
        ? body.executionId
        : typeof body.execution_id === "string"
          ? body.execution_id
          : base.executionId;

    const record: ExecutionRecord = { ...base, executionId, status: "running" };
    putExecution(record);
    return record;
  } catch (cause) {
    const record: ExecutionRecord = {
      ...base,
      status: "failed",
      error: `Could not reach CRE trigger: ${String(cause)}`,
    };
    putExecution(record);
    return record;
  }
}

/**
 * Returns the current view of an execution, refreshing from CRE_STATUS_URL when
 * one is configured.
 */
export async function fetchExecutionStatus(record: ExecutionRecord): Promise<ExecutionRecord> {
  const base = statusUrl();
  if (!base || record.status === "succeeded" || record.status === "failed") {
    return record;
  }

  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/${encodeURIComponent(record.executionId)}`, {
      headers: process.env.CRE_TRIGGER_AUTH ? { Authorization: process.env.CRE_TRIGGER_AUTH } : {},
      cache: "no-store",
    });
    if (!response.ok) return record;

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const status = typeof body.status === "string" ? body.status.toLowerCase() : undefined;

    const mapped: ExecutionRecord["status"] | undefined =
      status === "completed" || status === "succeeded"
        ? "succeeded"
        : status === "failed" || status === "errored"
          ? "failed"
          : status === "running" || status === "in_progress"
            ? "running"
            : undefined;

    if (!mapped) return record;

    return (
      updateExecution(record.executionId, {
        status: mapped,
        txHash: typeof body.txHash === "string" ? (body.txHash as Hex) : record.txHash,
      }) ?? record
    );
  } catch {
    // A status probe failing is not an execution failure — keep what we have.
    return record;
  }
}
