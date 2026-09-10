"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { erc20Abi, formatUnits, parseUnits, type Address } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import type { Application, ProposedMilestone } from "@/lib/applications";
import { grantEscrowAbi } from "@/lib/contracts";

type Draft = { title: string; criteria: string; amount: string };

function toDraft(milestones: ProposedMilestone[]): Draft[] {
  return milestones.map((m) => ({
    title: m.title,
    criteria: m.criteria,
    amount: formatUnits(BigInt(m.amount), 6),
  }));
}

function toBaseUnits(amount: string): bigint | null {
  try {
    const parsed = parseUnits(amount.trim() as `${number}`, 6);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The granter's side of the desk: adjust the milestone set, then escrow it.
 *
 * Milestone *amounts* are the only part the contract knows about — titles and
 * criteria stay off-chain, keyed to the grant id once funding lands. That split
 * is deliberate: putting prose on-chain costs gas and buys nothing, while the
 * amounts are exactly what the escrow has to enforce.
 *
 * Funding is two transactions because ERC-20 requires it: approve the escrow for
 * the total, then createGrant. The grant id is read from `nextGrantId()` before
 * the second call, which is what the contract will assign.
 */
export function ReviewPanel({
  application,
  escrowAddress,
  usdcAddress,
}: {
  application: Application;
  escrowAddress: Address;
  usdcAddress: Address;
}) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const [drafts, setDrafts] = useState<Draft[]>(() =>
    toDraft(application.approvedMilestones ?? application.proposedMilestones),
  );
  const [reviewNote, setReviewNote] = useState(application.reviewNote ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const valid = drafts.filter((d) => d.title.trim().length > 0 && toBaseUnits(d.amount) !== null);
  const total = valid.reduce((sum, d) => sum + (toBaseUnits(d.amount) ?? 0n), 0n);

  const proposedTotal = useMemo(
    () => application.proposedMilestones.reduce((sum, m) => sum + BigInt(m.amount), 0n),
    [application.proposedMilestones],
  );

  function update(index: number, patch: Partial<Draft>) {
    setDrafts((c) => c.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  const payload = useCallback(
    () =>
      valid.map((d) => ({
        title: d.title.trim(),
        criteria: d.criteria.trim(),
        amount: (toBaseUnits(d.amount) ?? 0n).toString(),
      })),
    [valid],
  );

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch(`/api/applications/${application.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? result.error ?? "Update failed.");
      return result;
    },
    [application.id],
  );

  const approve = useCallback(async () => {
    setBusy("approve");
    setError(null);
    try {
      await patch({ action: "approve", approvedMilestones: payload(), reviewNote });
      router.refresh();
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(null);
    }
  }, [patch, payload, reviewNote, router]);

  const decline = useCallback(async () => {
    setBusy("decline");
    setError(null);
    try {
      await patch({ action: "decline", reviewNote });
      router.refresh();
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setBusy(null);
    }
  }, [patch, reviewNote, router]);

  const fund = useCallback(async () => {
    if (!publicClient) return;
    setBusy("fund");
    setError(null);
    setProgress(null);
    try {
      const amounts = payload().map((m) => BigInt(m.amount));
      const sum = amounts.reduce((a, b) => a + b, 0n);

      setProgress("1/3 · Approving the escrow to move your USDC…");
      const approveHash = await writeContractAsync({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: "approve",
        args: [escrowAddress, sum],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      // Whatever nextGrantId reads now is the id createGrant will assign.
      const grantId = (await publicClient.readContract({
        address: escrowAddress,
        abi: grantEscrowAbi,
        functionName: "nextGrantId",
      })) as bigint;

      setProgress("2/3 · Escrowing the milestones on Arc…");
      const createHash = await writeContractAsync({
        address: escrowAddress,
        abi: grantEscrowAbi,
        functionName: "createGrant",
        args: [application.wallet as Address, usdcAddress, amounts],
      });
      await publicClient.waitForTransactionReceipt({ hash: createHash });

      setProgress("3/3 · Linking the application to grant #" + grantId.toString() + "…");
      await patch({ action: "mark-funded", grantId: grantId.toString(), fundingTxHash: createHash });

      router.push(`/grant/${grantId.toString()}`);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
      setProgress(null);
    } finally {
      setBusy(null);
    }
  }, [publicClient, payload, writeContractAsync, usdcAddress, escrowAddress, application.wallet, patch, router]);

  const decided = application.status === "approved" || application.status === "funded";
  const funded = application.status === "funded";

  return (
    <section className="card elev-sm" style={{ padding: 22, gap: 16 }}>
      <div className="flex flex-wrap items-center gap-2.5">
        <h4 className="m-0">Set the milestones</h4>
        <span className="ml-auto text-[13px]" style={{ opacity: 0.6 }}>
          proposed {formatUnits(proposedTotal, 6)} USDC
        </span>
      </div>

      <p className="m-0 text-[13px]" style={{ opacity: 0.7 }}>
        Adjust what you&apos;re willing to fund. Amounts go on-chain and the escrow enforces them; titles and criteria
        stay off-chain and become what the enclave scores evidence against.
      </p>

      {funded ? (
        <div
          className="rounded-[20px] px-4 py-3 text-[13.5px]"
          style={{ background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)" }}
        >
          <strong>Funded.</strong> Escrowed as grant #{application.grantId} on Arc.
        </div>
      ) : (
        drafts.map((draft, index) => (
          <div
            key={index}
            className="flex flex-col gap-3 rounded-[20px] p-4"
            style={{ background: "color-mix(in srgb, var(--color-text) 4%, transparent)" }}
          >
            <div className="flex items-center gap-2">
              <span
                className="grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold"
                style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
              >
                {index + 1}
              </span>
              <span className="text-[13px] font-semibold">Milestone {index + 1}</span>
              {drafts.length > 1 && (
                <button className="btn-ghost ml-auto" onClick={() => setDrafts((c) => c.filter((_, i) => i !== index))}>
                  Remove
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="field">
                <label htmlFor={`rv-title-${index}`}>Title</label>
                <input
                  id={`rv-title-${index}`}
                  className="input"
                  value={draft.title}
                  onChange={(e) => update(index, { title: e.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`rv-amount-${index}`}>Amount (USDC)</label>
                <input
                  id={`rv-amount-${index}`}
                  className="input"
                  inputMode="decimal"
                  value={draft.amount}
                  onChange={(e) => update(index, { amount: e.target.value })}
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor={`rv-criteria-${index}`}>What counts as done?</label>
              <textarea
                id={`rv-criteria-${index}`}
                className="input"
                style={{ minHeight: 64 }}
                value={draft.criteria}
                onChange={(e) => update(index, { criteria: e.target.value })}
              />
            </div>
          </div>
        ))
      )}

      {!funded && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="btn-secondary font-body font-semibold"
              onClick={() => setDrafts((c) => [...c, { title: "", criteria: "", amount: "" }])}
            >
              Add milestone
            </button>
            <span className="ml-auto text-[13px]">
              <span style={{ opacity: 0.6 }}>Funding</span> <strong>{formatUnits(total, 6)} USDC</strong>
            </span>
          </div>

          <div className="field">
            <label htmlFor="review-note">Note to the applicant</label>
            <textarea
              id="review-note"
              className="input"
              style={{ minHeight: 64 }}
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="Optional — why you adjusted the scope, what you want to see first."
            />
          </div>

          {progress && (
            <div
              className="flex items-center gap-3 rounded-[20px] px-4 py-3.5"
              style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
            >
              <span
                className="animate-spin-ring h-4 w-4 flex-none rounded-full"
                style={{
                  border: "2.5px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
                  borderTopColor: "var(--color-accent)",
                }}
                aria-hidden
              />
              <p className="m-0 text-[13.5px]">{progress}</p>
            </div>
          )}

          {error && (
            <div
              className="rounded-[20px] px-4 py-3 text-[13px]"
              style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
            >
              {error}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {!decided && (
              <button className="btn-secondary font-body font-semibold" onClick={approve} disabled={busy !== null || valid.length === 0}>
                {busy === "approve" ? "Saving…" : "Approve scope"}
              </button>
            )}
            <button
              className="btn-primary"
              onClick={fund}
              disabled={!isConnected || busy !== null || valid.length === 0}
              title={!isConnected ? "Connect the funding wallet first" : undefined}
            >
              {busy === "fund" ? "Funding…" : `Escrow ${formatUnits(total, 6)} USDC`}
            </button>
            <button className="btn-ghost" onClick={decline} disabled={busy !== null}>
              {busy === "decline" ? "…" : "Decline"}
            </button>
          </div>

          {!isConnected && (
            <p className="m-0 text-xs" style={{ opacity: 0.6 }}>
              Connect the wallet that holds the USDC to escrow this grant.
            </p>
          )}
          {isConnected && address && (
            <p className="m-0 text-xs" style={{ opacity: 0.55 }}>
              Funding from <span className="mono">{address.slice(0, 10)}…{address.slice(-6)}</span> — two transactions:
              an ERC-20 approval, then createGrant.
            </p>
          )}
        </>
      )}
    </section>
  );
}
