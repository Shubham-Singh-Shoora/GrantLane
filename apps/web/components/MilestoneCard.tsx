"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { grantEscrowAbi, formatUsdc } from "@/lib/contracts";
import { statusName, statusNodeColors, statusTagClass } from "@/lib/status";

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

/** Matches scoring.approvalThresholdBps in the CRE workflow's staging config. */
const PASS_MARK_BPS = 7000;

const ZERO_HASH = `0x${"0".repeat(64)}`;

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

  const [open, setOpen] = useState(milestone.status === 1);
  const [techOpen, setTechOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [artifacts, setArtifacts] = useState("");
  const [execution, setExecution] = useState<ExecutionView | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = milestone.status === 0 || milestone.status === 3;
  const scoring = milestone.status === 1;
  const settled = milestone.status === 2 || milestone.status === 4;
  const rejected = milestone.status === 3;
  const node = statusNodeColors(milestone.status);

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

  const scorePct = milestone.scoreBps / 100;

  return (
    <div className="relative">
      <span
        className="absolute left-[-34px] top-5 grid h-7 w-7 place-items-center rounded-full text-xs font-bold"
        style={{ background: node.bg, color: node.fg, boxShadow: "0 0 0 4px var(--color-bg)" }}
        aria-hidden
      >
        {milestone.milestoneId + 1}
      </span>

      <div className="card elev-sm overflow-hidden" style={{ padding: 0, gap: 0 }}>
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 px-5 py-[18px] text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)]"
        >
          <div className="min-w-0 flex-1">
            <p className="m-0 font-heading text-[17px] leading-tight">Milestone {milestone.milestoneId + 1}</p>
            <p className="m-0 mt-[3px] text-[12.5px]" style={{ opacity: 0.6 }}>
              {formatUsdc(BigInt(milestone.amount))} USDC
              {BigInt(milestone.paidAmount) > 0n && ` · ${formatUsdc(BigInt(milestone.paidAmount))} paid`}
            </p>
          </div>
          <span className={`${statusTagClass(milestone.status)} flex-none`}>{statusName(milestone.status)}</span>
          <span
            className="flex-none text-xs transition-transform duration-200"
            style={{ opacity: 0.45, transform: open ? "rotate(180deg)" : "none" }}
            aria-hidden
          >
            ▾
          </span>
        </button>

        {open && (
          <div className="animate-rise px-5 pb-5 pt-0.5">
            <div className="rule mb-4" />

            {/* — evidence composer — */}
            {isGrantee && canSubmit && (
              <div
                className="flex flex-col gap-3 rounded-[22px] p-4"
                style={{ background: "color-mix(in srgb, var(--color-text) 4%, transparent)" }}
              >
                <div className="field">
                  <label htmlFor={`summary-${milestone.milestoneId}`}>What did you deliver?</label>
                  <textarea
                    id={`summary-${milestone.milestoneId}`}
                    className="input"
                    value={summary}
                    onChange={(e) => setSummary(e.target.value)}
                    placeholder="Describe the work against the milestone criteria."
                  />
                </div>
                <div className="field">
                  <label htmlFor={`artifacts-${milestone.milestoneId}`}>Evidence links — one per line</label>
                  <textarea
                    id={`artifacts-${milestone.milestoneId}`}
                    className="input mono text-[13px]"
                    style={{ minHeight: 60 }}
                    value={artifacts}
                    onChange={(e) => setArtifacts(e.target.value)}
                    placeholder={"https://github.com/…/pull/128\nhttps://…/demo.mp4"}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="btn-primary"
                    onClick={submit}
                    disabled={!isConnected || submitting || isPending || summary.trim().length === 0}
                  >
                    {submitting || isPending ? "Submitting…" : "Submit for confidential scoring"}
                  </button>
                  <p className="m-0 flex-1 basis-[200px] text-xs" style={{ opacity: 0.6 }}>
                    Only a hash goes on-chain. The bundle itself is read by the scoring enclave.
                  </p>
                </div>
              </div>
            )}

            {/* — in flight — */}
            {scoring && (
              <div
                className="flex flex-wrap items-center gap-4 rounded-[22px] p-5"
                style={{ background: "color-mix(in srgb, var(--color-accent) 10%, transparent)" }}
              >
                <div className="flex flex-none gap-1.5" aria-hidden>
                  {[0, 0.18, 0.36].map((delay) => (
                    <span
                      key={delay}
                      className="animate-pulse-dot h-2.5 w-2.5 rounded-full"
                      style={{ background: "var(--color-accent)", animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
                <div className="min-w-0 flex-1 basis-[220px]">
                  <p className="m-0 font-heading text-base">Scoring inside the enclave</p>
                  <p className="m-0 mt-[3px] text-[12.5px]" style={{ opacity: 0.7 }}>
                    Sealed inside the scoring enclave — nobody at the fund can read this submission.
                  </p>
                </div>
                <div className="track relative h-1.5 flex-1 basis-full">
                  <div
                    className="animate-sweep absolute inset-0 rounded-full"
                    style={{ width: "34%", background: "var(--color-accent)" }}
                  />
                </div>
              </div>
            )}

            {/* — settled — */}
            {settled && (
              <div
                className="rounded-[22px] px-5 py-[18px]"
                style={{ background: "color-mix(in srgb, var(--color-accent-2) 14%, transparent)" }}
              >
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <p className="kicker m-0">Confidential score</p>
                  <p className="m-0 ml-auto font-heading text-2xl leading-none">{scorePct.toFixed(1)}%</p>
                </div>
                <div className="track relative my-3 h-2.5">
                  <div
                    className="h-full rounded-full transition-[width] duration-700"
                    style={{ background: "var(--color-accent-2)", width: `${Math.min(scorePct, 100)}%` }}
                  />
                  <span
                    className="absolute top-[-3px] h-4 w-0.5"
                    style={{
                      left: `${PASS_MARK_BPS / 100}%`,
                      background: "color-mix(in srgb, var(--color-text) 45%, transparent)",
                    }}
                    aria-hidden
                  />
                </div>
                <p className="m-0 text-[12.5px]" style={{ opacity: 0.7 }}>
                  Pass mark {PASS_MARK_BPS / 100}% · {formatUsdc(BigInt(milestone.paidAmount))} USDC released to the
                  payout wallet.
                </p>
              </div>
            )}

            {/* — changes requested — */}
            {rejected && (
              <div
                className="rounded-[22px] px-5 py-[18px]"
                style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
              >
                <p className="m-0 mb-1.5 font-heading text-base">Changes requested</p>
                <p className="m-0 mb-3 text-[13.5px]" style={{ opacity: 0.8 }}>
                  Scored {scorePct.toFixed(1)}% — below the {PASS_MARK_BPS / 100}% pass mark. The enclave returned a
                  verdict without revealing the submission.
                </p>
                {isGrantee && (
                  <p className="m-0 text-[13px]" style={{ opacity: 0.7 }}>
                    Edit the evidence above and resubmit.
                  </p>
                )}
              </div>
            )}

            {milestone.status === 0 && !isGrantee && (
              <p className="m-0 text-sm" style={{ opacity: 0.7 }}>
                Not started. The grantee submits evidence to begin confidential scoring.
              </p>
            )}

            {/* — technical detail — */}
            <button onClick={() => setTechOpen((v) => !v)} className="btn-ghost mt-3.5" style={{ paddingLeft: 0 }}>
              {techOpen ? "Hide technical detail" : "Technical detail"}
            </button>
            {techOpen && (
              <dl
                className="animate-rise m-0 mt-2.5 grid gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
              >
                {[
                  { label: "Evidence hash", value: milestone.evidenceHash === ZERO_HASH ? "—" : milestone.evidenceHash },
                  { label: "Amount", value: `${milestone.amount} base units` },
                  { label: "Paid", value: `${milestone.paidAmount} base units` },
                  { label: "Score", value: `${milestone.scoreBps} bps` },
                ].map((t) => (
                  <div key={t.label} className="min-w-0">
                    <dt className="kicker">{t.label}</dt>
                    <dd className="mono m-0 mt-[3px] break-all text-xs">{t.value}</dd>
                  </div>
                ))}
              </dl>
            )}

            {execution && (
              <p className="m-0 mt-3 text-xs" style={{ opacity: 0.6 }}>
                Run <span className="mono">{execution.executionId.slice(0, 24)}</span> — {execution.status}
                {execution.error && <span className="mt-1 block text-[var(--color-accent-700)]">{execution.error}</span>}
              </p>
            )}
            {note && (
              <p className="m-0 mt-3 text-xs" style={{ opacity: 0.7 }}>
                {note}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
