"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { isAddress, parseUnits } from "viem";
import { useAccount } from "wagmi";
import type { RepoSnapshot } from "@/lib/applications";
import { GithubRepoCard } from "./GithubRepoCard";
import { SelfieGate } from "./SelfieGate";
import { clearTicket } from "@/lib/ticket-cache";
import { clearDraft, loadDraft, saveDraft } from "@/lib/form-draft";

type DraftMilestone = { title: string; criteria: string; amount: string };

const EMPTY_MILESTONE: DraftMilestone = { title: "", criteria: "", amount: "" };

type Draft = {
  projectName: string;
  organisation: string;
  pitch: string;
  website: string;
  repoUrl: string;
  wallet: string;
  milestones: DraftMilestone[];
  savedAt: string;
};

const DRAFT_KEY = "application:v1";
/** Wait this long after the last keystroke before writing the draft. */
const SAVE_DEBOUNCE_MS = 600;

function isBlank(draft: Omit<Draft, "savedAt">): boolean {
  return (
    !draft.projectName.trim() &&
    !draft.organisation.trim() &&
    !draft.pitch.trim() &&
    !draft.website.trim() &&
    !draft.repoUrl.trim() &&
    !draft.wallet.trim() &&
    draft.milestones.every((m) => !m.title.trim() && !m.criteria.trim() && !m.amount.trim())
  );
}

/** USDC display amounts are decimal; the API and chain want 6-decimal base units. */
function toBaseUnits(amount: string): bigint | null {
  try {
    const parsed = parseUnits(amount.trim() as `${number}`, 6);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

export function ApplicationForm() {
  const router = useRouter();
  const { address } = useAccount();

  const [projectName, setProjectName] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [pitch, setPitch] = useState("");
  const [website, setWebsite] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [wallet, setWallet] = useState("");
  const [milestones, setMilestones] = useState<DraftMilestone[]>([{ ...EMPTY_MILESTONE }]);

  const [repo, setRepo] = useState<RepoSnapshot | null>(null);
  const [repoError, setRepoError] = useState<string | null>(null);
  const [repoLoading, setRepoLoading] = useState(false);

  const [verificationTicket, setVerificationTicket] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  // Autosaving starts only once the stored draft has been read back, or the first
  // pass would see empty fields and wipe the very draft being restored. State, not
  // a ref, so the save effect actually re-runs once the restore has happened.
  const [hydrated, setHydrated] = useState(false);
  // What was restored, so the save that follows a restore doesn't rewrite an
  // identical draft and relabel "restored" as "saved" a moment later.
  const restoredSnapshot = useRef<string | null>(null);

  const effectiveWallet = wallet.trim() || address || "";

  useEffect(() => {
    const draft = loadDraft<Draft>(DRAFT_KEY);
    if (draft) {
      setProjectName(draft.projectName ?? "");
      setOrganisation(draft.organisation ?? "");
      setPitch(draft.pitch ?? "");
      setWebsite(draft.website ?? "");
      setRepoUrl(draft.repoUrl ?? "");
      setWallet(draft.wallet ?? "");
      const milestones =
        Array.isArray(draft.milestones) && draft.milestones.length > 0 ? draft.milestones : [{ ...EMPTY_MILESTONE }];
      setMilestones(milestones);
      setSavedAt(draft.savedAt ?? null);
      setRestoredAt(draft.savedAt ?? null);
      restoredSnapshot.current = JSON.stringify({
        projectName: draft.projectName ?? "",
        organisation: draft.organisation ?? "",
        pitch: draft.pitch ?? "",
        website: draft.website ?? "",
        repoUrl: draft.repoUrl ?? "",
        wallet: draft.wallet ?? "",
        milestones,
      });
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const snapshot = { projectName, organisation, pitch, website, repoUrl, wallet, milestones };
    if (isBlank(snapshot)) {
      clearDraft(DRAFT_KEY);
      setSavedAt(null);
      return;
    }
    // Nothing has been touched since the restore — leave the stored draft alone.
    if (JSON.stringify(snapshot) === restoredSnapshot.current) return;
    restoredSnapshot.current = null;
    const timer = setTimeout(() => {
      const now = new Date().toISOString();
      saveDraft<Draft>(DRAFT_KEY, { ...snapshot, savedAt: now });
      setSavedAt(now);
      setRestoredAt(null);
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [hydrated, projectName, organisation, pitch, website, repoUrl, wallet, milestones]);

  const discardDraft = useCallback(() => {
    clearDraft(DRAFT_KEY);
    setProjectName("");
    setOrganisation("");
    setPitch("");
    setWebsite("");
    setRepoUrl("");
    setWallet("");
    setMilestones([{ ...EMPTY_MILESTONE }]);
    setRepo(null);
    setRepoError(null);
    setSavedAt(null);
    setRestoredAt(null);
  }, []);

  const lookupRepo = useCallback(async () => {
    if (!repoUrl.trim()) return;
    setRepoLoading(true);
    setRepoError(null);
    setRepo(null);
    try {
      const response = await fetch(`/api/github?url=${encodeURIComponent(repoUrl.trim())}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) {
        setRepoError(payload.detail ?? payload.error ?? "Lookup failed.");
        return;
      }
      setRepo(payload.repo as RepoSnapshot);
    } catch (cause) {
      setRepoError(String(cause));
    } finally {
      setRepoLoading(false);
    }
  }, [repoUrl]);

  function updateMilestone(index: number, patch: Partial<DraftMilestone>) {
    setMilestones((current) => current.map((m, i) => (i === index ? { ...m, ...patch } : m)));
  }

  const validMilestones = milestones.filter((m) => m.title.trim().length > 0 && toBaseUnits(m.amount) !== null);
  const total = validMilestones.reduce((sum, m) => sum + (toBaseUnits(m.amount) ?? 0n), 0n);

  const detailsComplete =
    projectName.trim().length > 0 &&
    pitch.trim().length >= 40 &&
    isAddress(effectiveWallet) &&
    validMilestones.length > 0;

  const submit = useCallback(async () => {
    if (!verificationTicket) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: projectName.trim(),
          organisation: organisation.trim(),
          pitch: pitch.trim(),
          website: website.trim() || undefined,
          repoUrl: repoUrl.trim() || undefined,
          wallet: effectiveWallet,
          verificationTicket,
          proposedMilestones: validMilestones.map((m) => ({
            title: m.title.trim(),
            criteria: m.criteria.trim(),
            amount: (toBaseUnits(m.amount) ?? 0n).toString(),
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(payload.detail ?? payload.error ?? "Could not submit the application.");
        return;
      }
      clearTicket("application");
      clearDraft(DRAFT_KEY);
      router.push(`/applications/${payload.application.id}?submitted=1`);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSubmitting(false);
    }
  }, [verificationTicket, projectName, organisation, pitch, website, repoUrl, effectiveWallet, validMilestones, router]);

  return (
    <div className="flex flex-col gap-5">
      {/* — the project — */}
      <section className="card elev-sm" style={{ padding: 22, gap: 14 }}>
        <h4 className="m-0">About the project</h4>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="project-name">Project name</label>
            <input
              id="project-name"
              className="input"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Fieldnote"
            />
          </div>
          <div className="field">
            <label htmlFor="organisation">Team or organisation</label>
            <input
              id="organisation"
              className="input"
              value={organisation}
              onChange={(e) => setOrganisation(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="pitch">What are you building, and what will this grant fund?</label>
          <textarea
            id="pitch"
            className="input"
            style={{ minHeight: 110 }}
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
            placeholder="A couple of paragraphs. The reviewer reads this before deciding what to fund."
          />
          <p className="m-0 mt-1 text-[11px]" style={{ opacity: 0.55 }}>
            {pitch.trim().length} characters{pitch.trim().length < 40 && " — at least 40"}
          </p>
        </div>
      </section>

      {/* — showing the work — */}
      <section className="card elev-sm" style={{ padding: 22, gap: 14 }}>
        <div>
          <h4 className="m-0">Show your work</h4>
          <p className="m-0 mt-1 text-[13px]" style={{ opacity: 0.7 }}>
            A live site and a public repo let the reviewer check what exists today rather than take it on trust.
          </p>
        </div>

        <div className="field">
          <label htmlFor="website">Website or demo</label>
          <input
            id="website"
            className="input"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://…"
          />
        </div>

        <div className="field">
          <label htmlFor="repo">GitHub repository</label>
          <div className="flex flex-wrap gap-2">
            <input
              id="repo"
              className="input"
              style={{ flex: "1 1 240px" }}
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value);
                setRepo(null);
                setRepoError(null);
              }}
              onBlur={lookupRepo}
              placeholder="https://github.com/owner/repo"
            />
            <button
              className="btn-secondary font-body font-semibold"
              onClick={lookupRepo}
              disabled={repoLoading || repoUrl.trim().length === 0}
            >
              {repoLoading ? "Checking…" : "Check repo"}
            </button>
          </div>
        </div>

        {repoError && (
          <p className="m-0 text-xs" style={{ color: "var(--color-accent-700)" }}>
            {repoError}
          </p>
        )}
        {repo && <GithubRepoCard repo={repo} />}
      </section>

      {/* — milestones — */}
      <section className="card elev-sm" style={{ padding: 22, gap: 14 }}>
        <div>
          <h4 className="m-0">Proposed milestones</h4>
          <p className="m-0 mt-1 text-[13px]" style={{ opacity: 0.7 }}>
            Break the work into checkpoints. The granter can adjust these before funding — what you propose is the
            starting point for that conversation, not the final contract.
          </p>
        </div>

        {milestones.map((milestone, index) => (
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
              {milestones.length > 1 && (
                <button
                  className="btn-ghost ml-auto"
                  onClick={() => setMilestones((c) => c.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="field">
                <label htmlFor={`ms-title-${index}`}>Title</label>
                <input
                  id={`ms-title-${index}`}
                  className="input"
                  value={milestone.title}
                  onChange={(e) => updateMilestone(index, { title: e.target.value })}
                  placeholder="Working prototype"
                />
              </div>
              <div className="field">
                <label htmlFor={`ms-amount-${index}`}>Amount (USDC)</label>
                <input
                  id={`ms-amount-${index}`}
                  className="input"
                  inputMode="decimal"
                  value={milestone.amount}
                  onChange={(e) => updateMilestone(index, { amount: e.target.value })}
                  placeholder="0.60"
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor={`ms-criteria-${index}`}>What counts as done?</label>
              <textarea
                id={`ms-criteria-${index}`}
                className="input"
                style={{ minHeight: 64 }}
                value={milestone.criteria}
                onChange={(e) => updateMilestone(index, { criteria: e.target.value })}
                placeholder="One criterion per line — specific enough that anyone could check a claim against it."
              />
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-secondary font-body font-semibold"
            onClick={() => setMilestones((c) => [...c, { ...EMPTY_MILESTONE }])}
          >
            Add milestone
          </button>
          <span className="ml-auto text-[13px]">
            <span style={{ opacity: 0.6 }}>Total requested</span>{" "}
            <strong>{(Number(total) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })} USDC</strong>
          </span>
        </div>
      </section>

      {/* — payout wallet — */}
      <section className="card elev-sm" style={{ padding: 22, gap: 14 }}>
        <h4 className="m-0">Where should this pay out?</h4>
        <div className="field">
          <label htmlFor="wallet">Payout wallet</label>
          <input
            id="wallet"
            className="input mono text-[12.5px]"
            value={wallet}
            onChange={(e) => setWallet(e.target.value)}
            placeholder={address ?? "0x…"}
          />
          <p className="m-0 mt-1 text-[11px]" style={{ opacity: 0.55 }}>
            {address && !wallet.trim()
              ? `Defaults to your connected wallet, ${address.slice(0, 10)}…`
              : "Changing this later needs a fresh Selfie Check."}
          </p>
        </div>
        {effectiveWallet.length > 0 && !isAddress(effectiveWallet) && (
          <p className="m-0 text-xs" style={{ color: "var(--color-accent-700)" }}>
            Not a valid address.
          </p>
        )}
      </section>

      {/* — the human gate — */}
      <SelfieGate
        purpose="application"
        signal={`application:${projectName.trim()}`}
        cacheKey="application"
        title="Confirm you're a real person"
        body="Grant rounds attract bots faster than they attract builders. A Selfie Check proves a live human filled this in, without telling us who you are. One verified person, one application."
        verifiedLabel="Your application can now be submitted."
        onVerified={setVerificationTicket}
      />

      {!detailsComplete && (
        <p className="m-0 text-[13px]" style={{ opacity: 0.7 }}>
          Fill in the project name, a pitch of at least 40 characters, a valid payout wallet and at least one milestone
          with an amount.
        </p>
      )}

      {error && (
        <div
          className="rounded-[20px] px-4 py-3 text-[13px]"
          style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
        >
          {error}
        </div>
      )}

      {savedAt && (
        <div className="flex flex-wrap items-center gap-2.5 text-[12.5px]" style={{ opacity: 0.75 }}>
          <span
            className="h-1.5 w-1.5 flex-none rounded-full"
            style={{ background: "var(--color-accent-2)" }}
            aria-hidden
          />
          <span suppressHydrationWarning>
            {restoredAt
              ? `Draft restored from ${new Date(savedAt).toLocaleString()}`
              : `Draft saved ${new Date(savedAt).toLocaleTimeString()}`}{" "}
            — kept in this browser only, never sent anywhere until you submit.
          </span>
          <button className="btn-ghost" onClick={discardDraft}>
            Discard draft
          </button>
        </div>
      )}

      <button
        className="btn-primary self-start"
        onClick={submit}
        disabled={!detailsComplete || !verificationTicket || submitting}
        style={{ fontSize: 15, padding: "11px 22px" }}
      >
        {submitting ? "Submitting…" : "Submit application"}
      </button>
    </div>
  );
}
