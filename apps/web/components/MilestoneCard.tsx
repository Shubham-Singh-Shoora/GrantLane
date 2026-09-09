"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { grantEscrowAbi, formatUsdc, MILESTONE_STATUS } from "@/lib/contracts";

export type MilestoneView = {
  milestoneId: number;
  amount: string;
  paidAmount: string;
  status: number;
  scoreBps: number;
  evidenceHash: string;
};

type ExecutionView = {
  executionId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  scoreBps?: number;
  approved?: boolean;
  error?: string;
};

const STATUS_STYLES: Record<number, string> = {
  0: "bg-white/5 text-muted ring-edge",
  1: "bg-warn/10 text-warn ring-warn/40",
  2: "bg-accent/10 text-accent ring-accent/40",
  3: "bg-danger/10 text-danger ring-danger/40",
  4: "bg-accent/15 text-accent ring-accent/50",
};

export function MilestoneCard({
  grantId,
  escrowAddress,
  milestone,
  isGrantee,
}: {
  grantId: string;
  escrowAddress: `0x${string}`;
  milestone: MilestoneView;
  isGrantee: boolean;
}) {
  const { isConnected } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();

  const [summary, setSummary] = useState("");
  const [artifacts, setArtifacts] = useState("");
  const [execution, setExecution] = useState<ExecutionView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const open = milestone.status === 0 || milestone.status === 3;

  // Poll while a scoring run is in flight. The endpoint reconciles CRE's view
  // with the milestone's on-chain state, so this stops once the report lands.
  useEffect(() => {
    if (!execution || execution.status === "succeeded" || execution.status === "failed") return;

    const timer = setInterval(async () => {
      try {
        const response = await fetch(
          `/api/execution-status?executionId=${encodeURIComponent(execution.executionId)}`,
          { cache: "no-store" },
        );
        if (!response.ok) return;
        const body = await response.json();
        setExecution(body.execution as ExecutionView);
      } catch {
        // transient — keep polling
      }
    }, 4000);

    return () => clearInterval(timer);
  }, [execution]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setNote(null);
    try {
      // 1. Hash + store the bundle server-side and start the CRE run.
      const response = await fetch("/api/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantId,
          milestoneId: milestone.milestoneId,
          summary,
          artifacts: artifacts
            .split("\n")
            .map((a) => a.trim())
            .filter(Boolean),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setNote(body.detail ?? body.error ?? "Could not submit evidence.");
        return;
      }

      // 2. Mirror the hash on-chain. Only the grantee can do this, and it is
      //    what moves the milestone into Submitted.
      await writeContractAsync({
        address: escrowAddress,
        abi: grantEscrowAbi,
        functionName: "submitEvidence",
        args: [BigInt(grantId), BigInt(milestone.milestoneId), body.evidenceHash],
      });

      setExecution(body.execution as ExecutionView);
      setNote("Evidence submitted. Scoring in progress.");
    } catch (cause) {
      setNote(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setSubmitting(false);
    }
  }, [grantId, milestone.milestoneId, summary, artifacts, escrowAddress, writeContractAsync]);

  return (
    <article className="panel p-5">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">Milestone {milestone.milestoneId + 1}</h3>
          <p className="text-xs text-muted">
            {formatUsdc(BigInt(milestone.amount))} USDC
            {BigInt(milestone.paidAmount) > 0n && ` · ${formatUsdc(BigInt(milestone.paidAmount))} paid`}
          </p>
        </div>
        <span className={`chip ${STATUS_STYLES[milestone.status] ?? STATUS_STYLES[0]}`}>
          {MILESTONE_STATUS[milestone.status] ?? "Unknown"}
        </span>
      </header>

      {milestone.scoreBps > 0 && (
        <p className="mb-3 text-xs text-muted">
          Confidential score: <span className="text-slate-200">{(milestone.scoreBps / 100).toFixed(1)}%</span>
        </p>
      )}

      {isGrantee && open && (
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor={`summary-${milestone.milestoneId}`}>
              What was delivered
            </label>
            <textarea
              id={`summary-${milestone.milestoneId}`}
              className="field min-h-[80px]"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Describe the work against the milestone criteria."
            />
          </div>
          <div>
            <label className="label" htmlFor={`artifacts-${milestone.milestoneId}`}>
              Evidence links (one per line)
            </label>
            <textarea
              id={`artifacts-${milestone.milestoneId}`}
              className="field min-h-[60px] font-mono text-xs"
              value={artifacts}
              onChange={(e) => setArtifacts(e.target.value)}
              placeholder={"https://github.com/…/pull/12\nhttps://…/demo.mp4"}
            />
          </div>
          <button
            className="btn-primary"
            onClick={submit}
            disabled={!isConnected || submitting || isPending || summary.trim().length === 0}
          >
            {submitting || isPending ? "Submitting…" : "Submit for scoring"}
          </button>
        </div>
      )}

      {execution && (
        <p className="mt-3 text-xs text-muted">
          Run <span className="font-mono">{execution.executionId.slice(0, 24)}</span> — {execution.status}
          {execution.error && <span className="block text-danger">{execution.error}</span>}
        </p>
      )}

      {note && <p className="mt-3 text-xs text-muted">{note}</p>}
    </article>
  );
}
