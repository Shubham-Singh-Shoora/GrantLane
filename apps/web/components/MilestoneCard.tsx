"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { erc20Abi, type Address, type Hex } from "viem";
import { useAccount } from "wagmi";
import { formatUsdc, grantEscrowAbi, publicClient, STATUS, type EscrowTerms } from "@/lib/contracts";
import { formatDuration, statusName, statusNodeColors, statusTagClass } from "@/lib/status";
import {
  ASSERT_TRUTH,
  UMA_FALSE,
  UMA_OOV3_ADDRESS,
  UMA_SANDBOX_ORACLE_ADDRESS,
  UMA_TRUE,
  disputeAncillaryData,
  umaOptimisticOracleAbi,
  umaSandboxOracleAbi,
} from "@/lib/uma";
import { txErrorMessage, useChainTx } from "@/lib/useChainTx";
import { clearTicket } from "@/lib/ticket-cache";
import { SelfieGate } from "./SelfieGate";

export type MilestoneView = {
  milestoneId: number;
  amount: string;
  status: number;
  /** Unix seconds: end of the current claim's dispute window. "0" until first claimed. */
  expiresAt: string;
  assertionId: Hex;
  evidenceHash: Hex;
  /** From the funded application; the chain stores only amounts and a terms hash. */
  title?: string;
  criteria?: string;
};

const ZERO_HASH = `0x${"0".repeat(64)}`;
const MIN_SUMMARY = 40;
const MAX_SCREENSHOTS = 6;

type Evidence = { summary: string; liveUrl: string; demoVideoUrl: string; repoUrl: string; screenshots: string };
const EMPTY_EVIDENCE: Evidence = { summary: "", liveUrl: "", demoVideoUrl: "", repoUrl: "", screenshots: "" };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Mirrors the server's checks so the grantee hears about a problem before a Selfie Check is spent. */
function evidenceProblem(e: Evidence): string | null {
  if (e.summary.trim().length < MIN_SUMMARY) {
    return `Describe what you delivered in at least ${MIN_SUMMARY} characters.`;
  }
  const links = [e.liveUrl, e.demoVideoUrl, e.repoUrl].map((s) => s.trim()).filter(Boolean);
  if (links.length === 0) return "Add at least one link someone can check: live product, demo video or repository.";
  const shots = lines(e.screenshots);
  if (shots.length > MAX_SCREENSHOTS) return `Up to ${MAX_SCREENSHOTS} screenshot links.`;
  const badLink = [...links, ...shots].find((u) => !isHttpUrl(u));
  if (badLink) return `Not a valid link: ${badLink}`;
  return null;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function countdown(seconds: number): string {
  if (seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}:${String(s).padStart(2, "0")}`;
}

export function MilestoneCard({
  grantId,
  grantee,
  terms,
  milestone,
  isGrantee,
  onActivity,
}: {
  grantId: string;
  /** The asserter of every claim on this grant — UMA's dispute data names them. */
  grantee: Address;
  terms: EscrowTerms;
  milestone: MilestoneView;
  isGrantee: boolean;
  /** Tells the page a transaction just landed, so it keeps re-reading the chain for a while. */
  onActivity?: () => void;
}) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const send = useChainTx();

  const status = milestone.status;
  const claimed = status === STATUS.Claimed;
  const disputed = status === STATUS.Disputed;
  const approved = status === STATUS.Approved;
  const rejected = status === STATUS.Rejected;
  const claimable = status === STATUS.Pending || rejected;

  const bond = BigInt(terms.bond);
  const liveness = Number(terms.liveness);
  const expiresAt = Number(milestone.expiresAt);
  const now = useNow(claimed);
  const secondsLeft = expiresAt - now;
  const windowClosed = claimed && secondsLeft <= 0;
  const windowElapsed = liveness > 0 ? Math.min(1, Math.max(0, 1 - secondsLeft / liveness)) : 1;
  const hasEvidence = milestone.evidenceHash !== ZERO_HASH;
  const node = statusNodeColors(status);
  const cacheKey = `milestone:${grantId}:${milestone.milestoneId}`;

  const [expanded, setExpanded] = useState(claimed || disputed);
  const [techOpen, setTechOpen] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Evidence>(EMPTY_EVIDENCE);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const problem = evidenceProblem(evidence);

  /** Runs one user action: one busy flag, one error slot, and a refresh from the chain afterwards. */
  const run = useCallback(
    async (label: string, action: () => Promise<string>) => {
      setBusy(label);
      setError(null);
      setNote(null);
      try {
        setNote(await action());
        onActivity?.();
        router.refresh();
      } catch (cause) {
        setError(txErrorMessage(cause));
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [router, onActivity],
  );

  const ensureAllowance = useCallback(
    async (spender: Address) => {
      if (!address) throw new Error("Connect a wallet first.");
      const current = await publicClient.readContract({
        address: terms.usdcAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, spender],
      });
      if (current < bond) {
        await send({ address: terms.usdcAddress, abi: erc20Abi, functionName: "approve", args: [spender, bond] });
      }
    },
    [address, terms.usdcAddress, bond, send],
  );

  const claim = () =>
    run("claim", async () => {
      setProgress("1/3 · Publishing your evidence and getting the claim signed…");
      const response = await fetch("/api/milestones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantId,
          milestoneId: milestone.milestoneId,
          verificationTicket: ticket,
          summary: evidence.summary,
          liveUrl: evidence.liveUrl,
          demoVideoUrl: evidence.demoVideoUrl,
          repoUrl: evidence.repoUrl,
          screenshots: lines(evidence.screenshots),
        }),
      });
      const prepared = await response.json();
      if (!response.ok) throw new Error(prepared.detail ?? prepared.error ?? "Could not prepare the claim.");

      setProgress(`2/3 · Approving your ${formatUsdc(bond)} USDC bond…`);
      await ensureAllowance(terms.escrowAddress);

      setProgress("3/3 · Asserting the claim on UMA…");
      await send({
        address: terms.escrowAddress,
        abi: grantEscrowAbi,
        functionName: "submitMilestone",
        args: [
          BigInt(grantId),
          BigInt(milestone.milestoneId),
          prepared.evidenceURI as string,
          prepared.evidenceHash as Hex,
          {
            nullifierHash: prepared.attestation.nullifierHash as Hex,
            deadline: BigInt(prepared.attestation.deadline),
            signature: prepared.attestation.signature as Hex,
          },
        ],
      });

      // The claim landed, so that Selfie Check is spent.
      clearTicket(cacheKey);
      setTicket(null);
      setEvidence(EMPTY_EVIDENCE);
      return `Claim submitted. It's open to dispute for ${formatDuration(liveness)}.`;
    });

  const dispute = () =>
    run("dispute", async () => {
      if (!address) throw new Error("Connect a wallet first.");
      setProgress(`1/2 · Approving your ${formatUsdc(bond)} USDC dispute bond for UMA…`);
      await ensureAllowance(UMA_OOV3_ADDRESS);
      setProgress("2/2 · Disputing the claim on UMA…");
      await send({
        address: UMA_OOV3_ADDRESS,
        abi: umaOptimisticOracleAbi,
        functionName: "disputeAssertion",
        args: [milestone.assertionId, address],
      });
      return "Disputed. UMA now decides; whoever is wrong loses their bond.";
    });

  const answerAsUma = (claimWasTrue: boolean) =>
    run(claimWasTrue ? "answer-true" : "answer-false", async () => {
      // The escrow sets expiresAt = assertion time + liveness in the same transaction,
      // and UMA's price request is made for the assertion time.
      const assertionTime = BigInt(expiresAt) - BigInt(terms.liveness);
      await send({
        address: UMA_SANDBOX_ORACLE_ADDRESS,
        abi: umaSandboxOracleAbi,
        functionName: "pushPrice",
        args: [
          ASSERT_TRUTH,
          assertionTime,
          disputeAncillaryData(milestone.assertionId, grantee),
          claimWasTrue ? UMA_TRUE : UMA_FALSE,
        ],
      });
      return `Answered: the claim was ${claimWasTrue ? "true" : "false"}. Settle to apply it.`;
    });

  const settle = () =>
    run("settle", async () => {
      await send({
        address: terms.escrowAddress,
        abi: grantEscrowAbi,
        functionName: "settle",
        args: [BigInt(grantId), BigInt(milestone.milestoneId)],
      });
      return "Settled.";
    });

  const subtitle = claimed
    ? windowClosed
      ? " · window closed, ready to settle"
      : ` · open to dispute for ${countdown(secondsLeft)}`
    : disputed
      ? " · with UMA"
      : "";

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
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex w-full items-center gap-3 px-5 py-[18px] text-left transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)]"
        >
          <div className="min-w-0 flex-1">
            <p className="m-0 font-heading text-[17px] leading-tight">
              {milestone.title || `Milestone ${milestone.milestoneId + 1}`}
            </p>
            <p className="m-0 mt-[3px] text-[12.5px]" style={{ opacity: 0.6 }} suppressHydrationWarning>
              {formatUsdc(BigInt(milestone.amount))} USDC{subtitle}
            </p>
          </div>
          <span className={`${statusTagClass(status)} flex-none`}>{statusName(status)}</span>
          <span
            className="flex-none text-xs transition-transform duration-200"
            style={{ opacity: 0.45, transform: expanded ? "rotate(180deg)" : "none" }}
            aria-hidden
          >
            ▾
          </span>
        </button>

        {expanded && (
          <div className="animate-rise flex flex-col gap-4 px-5 pb-5 pt-0.5">
            <div className="rule" />

            {milestone.criteria && (
              <div>
                <p className="kicker m-0">What counts as done</p>
                <p className="m-0 mt-1 whitespace-pre-wrap text-[13.5px]" style={{ opacity: 0.8 }}>
                  {milestone.criteria}
                </p>
              </div>
            )}

            {hasEvidence && (
              <a
                href={`/evidence/${milestone.evidenceHash}`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost self-start"
                style={{ paddingLeft: 0 }}
              >
                {claimable ? "Previous claim's evidence ↗" : "Read the evidence ↗"}
              </a>
            )}

            {/* — claimed: inside the dispute window — */}
            {claimed && (
              <div
                className="flex flex-col gap-3 rounded-[22px] p-5"
                style={{ background: "color-mix(in srgb, var(--color-accent) 10%, transparent)" }}
              >
                <div className="flex flex-wrap items-baseline gap-2.5">
                  <p className="m-0 font-heading text-base">
                    {windowClosed ? "Nobody disputed it" : "Open to dispute"}
                  </p>
                  {!windowClosed && (
                    <p className="mono m-0 ml-auto text-[20px] leading-none" suppressHydrationWarning>
                      {countdown(secondsLeft)}
                    </p>
                  )}
                </div>
                <div className="track h-2">
                  <div
                    className="h-full rounded-full transition-[width] duration-1000"
                    style={{ background: "var(--color-accent)", width: `${windowElapsed * 100}%` }}
                    suppressHydrationWarning
                  />
                </div>
                <p className="m-0 text-[12.5px]" style={{ opacity: 0.75 }}>
                  {windowClosed
                    ? "The window has closed. Anyone can settle it now to release the funds and return the bond."
                    : `The grantee posted a ${formatUsdc(bond)} USDC bond. If nobody disputes before the timer runs out, the milestone pays out. Anyone can dispute by matching the bond; UMA then decides, and whoever is wrong loses theirs.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {!windowClosed && isConnected && !isGrantee && (
                    <button className="btn-secondary font-body font-semibold" onClick={dispute} disabled={busy !== null}>
                      {busy === "dispute" ? "Disputing…" : `Dispute · ${formatUsdc(bond)} USDC bond`}
                    </button>
                  )}
                  {windowClosed && (
                    <button className="btn-primary" onClick={settle} disabled={!isConnected || busy !== null}>
                      {busy === "settle" ? "Settling…" : "Settle and release"}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* — disputed: UMA decides — */}
            {disputed && (
              <div
                className="flex flex-col gap-3 rounded-[22px] p-5"
                style={{ background: "color-mix(in srgb, var(--color-accent-400) 14%, transparent)" }}
              >
                <p className="m-0 font-heading text-base">Disputed — UMA decides</p>
                <p className="m-0 text-[12.5px]" style={{ opacity: 0.75 }}>
                  Both sides have a {formatUsdc(bond)} USDC bond at stake. If the claim was true the grantee is paid and
                  takes the disputer&apos;s bond; if false the milestone reopens and the disputer takes the grantee&apos;s.
                  On mainnet this goes to UMA&apos;s token-holder vote.
                </p>

                <div
                  className="flex flex-col gap-2.5 rounded-[18px] p-4"
                  style={{ border: "1.5px dashed color-mix(in srgb, var(--color-text) 25%, transparent)" }}
                >
                  <p className="kicker m-0">Testnet only · stand-in for UMA&apos;s vote</p>
                  <p className="m-0 text-[12.5px]" style={{ opacity: 0.75 }}>
                    Base Sepolia answers disputes through UMA&apos;s sandbox oracle, which anyone can answer. Pick the
                    outcome, then settle.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="btn-secondary font-body font-semibold"
                      onClick={() => answerAsUma(true)}
                      disabled={!isConnected || busy !== null}
                    >
                      {busy === "answer-true" ? "Answering…" : "Claim was true"}
                    </button>
                    <button
                      className="btn-secondary font-body font-semibold"
                      onClick={() => answerAsUma(false)}
                      disabled={!isConnected || busy !== null}
                    >
                      {busy === "answer-false" ? "Answering…" : "Claim was false"}
                    </button>
                    <button className="btn-primary" onClick={settle} disabled={!isConnected || busy !== null}>
                      {busy === "settle" ? "Settling…" : "Settle"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* — approved — */}
            {approved && (
              <div
                className="rounded-[22px] px-5 py-[18px]"
                style={{ background: "color-mix(in srgb, var(--color-accent-2) 14%, transparent)" }}
              >
                <p className="m-0 font-heading text-base">Approved</p>
                <p className="m-0 mt-1 text-[13px]" style={{ opacity: 0.75 }}>
                  {formatUsdc(BigInt(milestone.amount))} USDC credited to the payout wallet, and the bond went back to the
                  grantee. The payout wallet withdraws it from the panel alongside.
                </p>
              </div>
            )}

            {/* — rejected — */}
            {rejected && (
              <div
                className="rounded-[22px] px-5 py-[18px]"
                style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
              >
                <p className="m-0 font-heading text-base">Claim rejected</p>
                <p className="m-0 mt-1 text-[13px]" style={{ opacity: 0.75 }}>
                  UMA found the last claim false, so its bond went to the disputer. The milestone is open to claim again
                  with stronger evidence.
                </p>
              </div>
            )}

            {status === STATUS.Pending && !isGrantee && (
              <p className="m-0 text-sm" style={{ opacity: 0.7 }}>
                Not claimed yet. The grantee claims it with evidence and a bond when the work is done.
              </p>
            )}

            {/* — the human gate, then the claim — */}
            {isGrantee && claimable && !ticket && (
              <SelfieGate
                purpose="milestone"
                signal={cacheKey}
                cacheKey={cacheKey}
                title="Confirm you're claiming this yourself"
                body="A claim can release real money. A Selfie Check proves a live human is making it — not a script that got hold of a session."
                verifiedLabel="You can now submit your claim."
                onVerified={setTicket}
              />
            )}

            {isGrantee && claimable && ticket && (
              <div
                className="animate-rise flex flex-col gap-3 rounded-[22px] p-4"
                style={{ background: "color-mix(in srgb, var(--color-text) 4%, transparent)" }}
              >
                <div className="field">
                  <label htmlFor={`summary-${milestone.milestoneId}`}>What did you deliver?</label>
                  <textarea
                    id={`summary-${milestone.milestoneId}`}
                    className="input"
                    value={evidence.summary}
                    onChange={(e) => setEvidence((c) => ({ ...c, summary: e.target.value }))}
                    placeholder="Describe the work against the milestone criteria — specific enough that someone could check it."
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["liveUrl", "Live product", "https://…"],
                      ["demoVideoUrl", "Demo video", "https://youtu.be/…"],
                      ["repoUrl", "Repository", "https://github.com/…"],
                    ] as const
                  ).map(([key, label, placeholder]) => (
                    <div key={key} className="field">
                      <label htmlFor={`${key}-${milestone.milestoneId}`}>{label}</label>
                      <input
                        id={`${key}-${milestone.milestoneId}`}
                        className="input mono text-[12.5px]"
                        value={evidence[key]}
                        onChange={(e) => setEvidence((c) => ({ ...c, [key]: e.target.value }))}
                        placeholder={placeholder}
                      />
                    </div>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor={`shots-${milestone.milestoneId}`}>Screenshot links — optional, one per line</label>
                  <textarea
                    id={`shots-${milestone.milestoneId}`}
                    className="input mono text-[12.5px]"
                    style={{ minHeight: 56 }}
                    value={evidence.screenshots}
                    onChange={(e) => setEvidence((c) => ({ ...c, screenshots: e.target.value }))}
                    placeholder="https://…/screenshot.png"
                  />
                </div>

                {problem && (evidence.summary.length > 0 || evidence.liveUrl || evidence.repoUrl || evidence.demoVideoUrl) && (
                  <p className="m-0 text-xs" style={{ color: "var(--color-accent-700)" }}>
                    {problem}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    className="btn-primary"
                    onClick={claim}
                    disabled={!isConnected || busy !== null || problem !== null}
                  >
                    {busy === "claim" ? "Claiming…" : `Claim with a ${formatUsdc(bond)} USDC bond`}
                  </button>
                  <p className="m-0 flex-1 basis-[220px] text-xs" style={{ opacity: 0.6 }}>
                    Your evidence is published and its hash goes on-chain. The claim is open to dispute for{" "}
                    {formatDuration(liveness)}; you get the bond back unless UMA finds it false.
                  </p>
                </div>
              </div>
            )}

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
              <p className="m-0 break-words text-xs" style={{ color: "var(--color-accent-700)" }}>
                {error}
              </p>
            )}
            {note && (
              <p className="m-0 text-xs" style={{ opacity: 0.75 }}>
                {note}
              </p>
            )}

            {/* — technical detail — */}
            <button onClick={() => setTechOpen((v) => !v)} className="btn-ghost self-start" style={{ paddingLeft: 0 }}>
              {techOpen ? "Hide technical detail" : "Technical detail"}
            </button>
            {techOpen && (
              <dl
                className="animate-rise m-0 grid gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
              >
                {[
                  { label: "UMA assertion", value: milestone.assertionId === ZERO_HASH ? "—" : milestone.assertionId },
                  { label: "Evidence hash", value: hasEvidence ? milestone.evidenceHash : "—" },
                  {
                    label: "Dispute window ends",
                    value: expiresAt > 0 ? new Date(expiresAt * 1000).toLocaleString() : "—",
                  },
                  { label: "Amount", value: `${milestone.amount} base units` },
                ].map((t) => (
                  <div key={t.label} className="min-w-0">
                    <dt className="kicker">{t.label}</dt>
                    <dd className="mono m-0 mt-[3px] break-all text-xs">{t.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
