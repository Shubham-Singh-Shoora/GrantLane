"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { erc20Abi, type Address, type Hex } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { CHAIN_ID } from "@/lib/chain";
import { disputeRegistryAbi, formatUsdc, grantEscrowAbi, publicClient, STATUS, type EscrowTerms } from "@/lib/contracts";
import { formatDuration, shortAddress, statusName, statusNodeColors, statusTagClass } from "@/lib/status";
import {
  ASSERT_TRUTH,
  UMA_FALSE,
  UMA_OOV3_ADDRESS,
  UMA_SANDBOX_ORACLE_ADDRESS,
  UMA_TRUE,
  disputeAncillaryData,
  umaAssertionAbi,
  umaSandboxOracleAbi,
} from "@/lib/uma";
import { txErrorMessage, useChainTx } from "@/lib/useChainTx";
import { clearTicket } from "@/lib/ticket-cache";
import { DisputeHistory } from "./DisputeHistory";
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
const MIN_DISPUTE_REASON = 40;
const MAX_DISPUTE_LINKS = 6;

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

/** Mirrors /api/disputes, so a disputer hears about a problem before approving a bond. */
function disputeProblem(reason: string, links: string[]): string | null {
  if (reason.trim().length < MIN_DISPUTE_REASON) {
    return `Explain what's wrong with the claim in at least ${MIN_DISPUTE_REASON} characters.`;
  }
  if (links.length > MAX_DISPUTE_LINKS) return `Up to ${MAX_DISPUTE_LINKS} links.`;
  const badLink = links.find((u) => !isHttpUrl(u));
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
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");
  const [disputeLinks, setDisputeLinks] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  // Who raised the dispute lives on UMA, not in the escrow. Neither side of a
  // dispute should be deciding it, so the answer buttons are offered only to a
  // wallet with nothing at stake here.
  const { data: assertion } = useReadContract({
    address: UMA_OOV3_ADDRESS,
    abi: umaAssertionAbi,
    functionName: "getAssertion",
    args: [milestone.assertionId],
    chainId: CHAIN_ID,
    query: { enabled: disputed && milestone.assertionId !== ZERO_HASH },
  });
  const disputer = assertion?.disputer;
  const isParty =
    !!address &&
    (address.toLowerCase() === grantee.toLowerCase() ||
      (!!disputer && address.toLowerCase() === disputer.toLowerCase()));
  const canAnswerAsUma = isConnected && !!disputer && !isParty;

  // The price request UMA opened for this dispute: made for the assertion time,
  // which the escrow fixes as expiresAt - liveness in the same transaction.
  const assertionTime = expiresAt > 0 ? BigInt(expiresAt) - BigInt(terms.liveness) : 0n;
  const disputeAncillary = useMemo(
    () => disputeAncillaryData(milestone.assertionId, grantee),
    [milestone.assertionId, grantee],
  );

  // Settling a disputed claim reverts until the dispute has an answer, so Settle
  // only appears once one exists. Polled, because the answer usually comes from a
  // different wallet than the one looking at this page.
  const { data: answered, refetch: refetchAnswered } = useReadContract({
    address: UMA_SANDBOX_ORACLE_ADDRESS,
    abi: umaSandboxOracleAbi,
    functionName: "hasPrice",
    args: [ASSERT_TRUTH, assertionTime, disputeAncillary],
    chainId: CHAIN_ID,
    query: { enabled: disputed, refetchInterval: disputed ? 5_000 : false },
  });
  const { data: answer, refetch: refetchAnswer } = useReadContract({
    address: UMA_SANDBOX_ORACLE_ADDRESS,
    abi: umaSandboxOracleAbi,
    functionName: "getPrice",
    args: [ASSERT_TRUTH, assertionTime, disputeAncillary],
    chainId: CHAIN_ID,
    query: { enabled: disputed && answered === true },
  });
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const problem = evidenceProblem(evidence);
  const disputeIssue = disputeProblem(disputeReason, lines(disputeLinks));

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

  // A dispute goes through DisputeRegistry, never straight to UMA: in one transaction
  // it raises the dispute in the disputer's name and records the hash of their reason.
  const dispute = () =>
    run("dispute", async () => {
      if (!address) throw new Error("Connect a wallet first.");
      const registry = terms.disputeRegistryAddress;
      if (!registry) throw new Error("Disputes aren't configured on this deployment.");

      setProgress("1/3 · Publishing your reason…");
      const response = await fetch("/api/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grantId,
          milestoneId: milestone.milestoneId,
          reason: disputeReason,
          links: lines(disputeLinks),
        }),
      });
      const prepared = await response.json();
      if (!response.ok) throw new Error(prepared.detail ?? prepared.error ?? "Could not prepare the dispute.");

      setProgress(`2/3 · Approving your ${formatUsdc(bond)} USDC dispute bond…`);
      await ensureAllowance(registry);

      setProgress("3/3 · Disputing on UMA and recording your reason on-chain…");
      await send({
        address: registry,
        abi: disputeRegistryAbi,
        functionName: "dispute",
        args: [
          BigInt(grantId),
          BigInt(milestone.milestoneId),
          prepared.reasonHash as Hex,
          prepared.reasonURI as string,
        ],
      });

      setDisputeOpen(false);
      setDisputeReason("");
      setDisputeLinks("");
      return "Disputed. Your reason is recorded on-chain; UMA now decides, and whoever is wrong loses their bond.";
    });

  const answerAsUma = (claimWasTrue: boolean) =>
    run(claimWasTrue ? "answer-true" : "answer-false", async () => {
      await send({
        address: UMA_SANDBOX_ORACLE_ADDRESS,
        abi: umaSandboxOracleAbi,
        functionName: "pushPrice",
        args: [ASSERT_TRUTH, assertionTime, disputeAncillary, claimWasTrue ? UMA_TRUE : UMA_FALSE],
      });
      await refetchAnswered();
      await refetchAnswer();
      return claimWasTrue
        ? "Answered: the grantee is right. Settle to approve the milestone."
        : "Answered: the disputer is right. Settle to reject the claim.";
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
      ? answered
        ? answer === UMA_TRUE
          ? " · grantee judged right, ready to settle"
          : " · disputer judged right, ready to settle"
        : " · disputed, awaiting an answer"
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

            {terms.disputeRegistryAddress && (
              <DisputeHistory
                registry={terms.disputeRegistryAddress}
                grantId={grantId}
                milestoneId={milestone.milestoneId}
                currentAssertionId={milestone.assertionId}
                live={claimed || disputed}
              />
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
                    : `The grantee posted a ${formatUsdc(bond)} USDC bond. If nobody disputes before the timer runs out, the milestone pays out. Anyone can dispute by explaining what's wrong and matching the bond; UMA then decides, and whoever is wrong loses theirs.`}
                </p>
                <div className="flex flex-wrap gap-2">
                  {!windowClosed && isConnected && !isGrantee && !disputeOpen && (
                    <button
                      className="btn-secondary font-body font-semibold"
                      onClick={() => setDisputeOpen(true)}
                      disabled={busy !== null || !terms.disputeRegistryAddress}
                    >
                      Dispute this claim
                    </button>
                  )}
                  {windowClosed && (
                    <button className="btn-primary" onClick={settle} disabled={!isConnected || busy !== null}>
                      {busy === "settle" ? "Settling…" : "Settle and release"}
                    </button>
                  )}
                </div>
                {!windowClosed && isConnected && !isGrantee && !terms.disputeRegistryAddress && (
                  <p className="m-0 text-[12px]" style={{ opacity: 0.65 }}>
                    Disputes aren&apos;t configured on this deployment.
                  </p>
                )}

                {!windowClosed && disputeOpen && (
                  <div
                    className="animate-rise flex flex-col gap-3 rounded-[18px] p-4"
                    style={{ background: "color-mix(in srgb, var(--color-bg) 70%, transparent)" }}
                  >
                    <div className="field">
                      <label htmlFor={`dispute-reason-${milestone.milestoneId}`}>What&apos;s wrong with this claim?</label>
                      <textarea
                        id={`dispute-reason-${milestone.milestoneId}`}
                        className="input"
                        value={disputeReason}
                        onChange={(e) => setDisputeReason(e.target.value)}
                        placeholder="Be specific: which criterion isn't met, and how anyone can check it."
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`dispute-links-${milestone.milestoneId}`}>
                        Links that back it up — optional, one per line
                      </label>
                      <textarea
                        id={`dispute-links-${milestone.milestoneId}`}
                        className="input mono text-[12.5px]"
                        style={{ minHeight: 56 }}
                        value={disputeLinks}
                        onChange={(e) => setDisputeLinks(e.target.value)}
                        placeholder="https://…"
                      />
                    </div>
                    {disputeIssue && disputeReason.length > 0 && (
                      <p className="m-0 text-xs" style={{ color: "var(--color-accent-700)" }}>
                        {disputeIssue}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <button className="btn-primary" onClick={dispute} disabled={busy !== null || disputeIssue !== null}>
                        {busy === "dispute" ? "Disputing…" : `Dispute with a ${formatUsdc(bond)} USDC bond`}
                      </button>
                      <button
                        className="btn-secondary font-body font-semibold"
                        onClick={() => setDisputeOpen(false)}
                        disabled={busy !== null}
                      >
                        Cancel
                      </button>
                    </div>
                    <p className="m-0 text-[12px]" style={{ opacity: 0.6 }}>
                      Your reason is published and its hash is recorded on-chain with the dispute. It stays visible to
                      everyone whatever UMA decides.
                    </p>
                  </div>
                )}
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
                  Both sides have a {formatUsdc(bond)} USDC bond at stake. If the grantee is right, the milestone is paid
                  and they take the disputer&apos;s bond. If the disputer is right, the claim is rejected, the milestone
                  reopens and the disputer takes the grantee&apos;s bond. On mainnet UMA&apos;s token holders decide.
                </p>
                {disputer && (
                  <p className="m-0 text-[12.5px]" style={{ opacity: 0.7 }}>
                    Claimed by <span className="mono">{shortAddress(grantee)}</span>, disputed by{" "}
                    <span className="mono">{shortAddress(disputer)}</span>.
                  </p>
                )}

                <div
                  className="flex flex-col gap-2.5 rounded-[18px] p-4"
                  style={{ border: "1.5px dashed color-mix(in srgb, var(--color-text) 25%, transparent)" }}
                >
                  <p className="kicker m-0">Testnet only · stand-in for UMA&apos;s vote</p>
                  {answered ? (
                    <p className="m-0 text-[12.5px]" style={{ opacity: 0.85 }}>
                      <strong>Answered:</strong>{" "}
                      {answer === undefined
                        ? "…"
                        : answer === UMA_TRUE
                          ? "the grantee is right. Settling approves the milestone and gives the grantee the disputer's bond."
                          : "the disputer is right. Settling rejects the claim, reopens the milestone and gives the disputer the grantee's bond."}
                    </p>
                  ) : canAnswerAsUma ? (
                    <>
                      <p className="m-0 text-[12.5px]" style={{ opacity: 0.75 }}>
                        You have nothing at stake in this dispute, so you can stand in for UMA&apos;s voters. Read the
                        evidence and the dispute, decide who is right, then settle to apply it.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="btn-secondary font-body font-semibold"
                          onClick={() => answerAsUma(true)}
                          disabled={busy !== null}
                        >
                          {busy === "answer-true" ? "Answering…" : "Grantee is right"}
                        </button>
                        <button
                          className="btn-secondary font-body font-semibold"
                          onClick={() => answerAsUma(false)}
                          disabled={busy !== null}
                        >
                          {busy === "answer-false" ? "Answering…" : "Disputer is right"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <p className="m-0 text-[12.5px]" style={{ opacity: 0.75 }}>
                      {isParty
                        ? "You have a bond riding on this dispute, so GrantLane won't hand you the answer — a wallet with nothing at stake has to give it. On mainnet neither side could: UMA's token holders vote."
                        : !isConnected
                          ? "Connect a wallet that is neither the claimant nor the disputer to stand in for UMA's voters."
                          : "Checking who raised this dispute…"}
                    </p>
                  )}
                  <p className="m-0 text-[11.5px]" style={{ opacity: 0.55 }}>
                    UMA&apos;s sandbox oracle is open to anyone on-chain; withholding this from the two sides is
                    GrantLane keeping the demo honest, not a guarantee the chain enforces.
                  </p>
                </div>

                {answered ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="btn-primary" onClick={settle} disabled={!isConnected || busy !== null}>
                      {busy === "settle"
                        ? "Settling…"
                        : answer === UMA_TRUE
                          ? "Settle — approve the milestone"
                          : answer === UMA_FALSE
                            ? "Settle — reject the claim"
                            : "Settle"}
                    </button>
                    <p className="m-0 flex-1 basis-[220px] text-[12px]" style={{ opacity: 0.6 }}>
                      The dispute has an answer, so anyone can settle now — settling only applies it.
                    </p>
                  </div>
                ) : (
                  <p className="m-0 text-[12px]" style={{ opacity: 0.6 }}>
                    Settle appears once the dispute has an answer. Until then nobody can settle it — UMA refuses to.
                  </p>
                )}
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
                  The disputer was right, so the grantee&apos;s bond went to them. The milestone is open to claim again
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
