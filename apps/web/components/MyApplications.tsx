"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import type { Application } from "@/lib/applications";
import { NotifyToggle, notifyStatusChange } from "./NotifyToggle";

const STATUS_TAG: Record<string, string> = {
  submitted: "tag tag-accent",
  approved: "tag tag-accent-2",
  funded: "tag tag-accent-2",
  declined: "tag tag-neutral",
};

const STATUS_LABEL: Record<string, string> = {
  submitted: "In review",
  approved: "Scope agreed",
  funded: "Funded",
  declined: "Declined",
};

/** How often to re-check. Slow enough to be free, fast enough to feel live. */
const POLL_MS = 20_000;

export function MyApplications() {
  const { address, isConnected } = useAccount();
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Remembers the last status seen per application, so a change can be
  // announced exactly once rather than on every poll.
  const seen = useRef<Map<string, string>>(new Map());

  const load = useCallback(
    async (announce: boolean) => {
      if (!address) return;
      try {
        const response = await fetch(`/api/applications?wallet=${address}`, { cache: "no-store" });
        const body = await response.json();
        if (!response.ok) {
          setError(body.detail ?? body.error ?? "Could not load your applications.");
          return;
        }

        const next = body.applications as Application[];
        if (announce) {
          for (const application of next) {
            const previous = seen.current.get(application.id);
            if (previous && previous !== application.status) {
              notifyStatusChange(application.projectName, application.status);
            }
          }
        }
        for (const application of next) seen.current.set(application.id, application.status);

        setApplications(next);
        setError(null);
      } catch (cause) {
        setError(String(cause));
      }
    },
    [address],
  );

  useEffect(() => {
    if (!address) return;
    void load(false);
    const timer = setInterval(() => void load(true), POLL_MS);
    return () => clearInterval(timer);
  }, [address, load]);

  if (!isConnected) {
    return (
      <div className="card elev-sm" style={{ padding: 26, gap: 10 }}>
        <h4 className="m-0">Connect your wallet</h4>
        <p className="m-0 text-[14px]" style={{ opacity: 0.75 }}>
          Your applications are tied to the payout wallet you applied with. Connect it to see them.
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="rounded-[20px] px-4 py-3.5 text-[13.5px]"
        style={{ background: "color-mix(in srgb, var(--color-accent) 12%, transparent)" }}
      >
        {error}
      </div>
    );
  }

  if (applications === null) {
    return (
      <p className="m-0 text-[14px]" style={{ opacity: 0.65 }}>
        Loading…
      </p>
    );
  }

  if (applications.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-3 rounded-[32px] px-7 py-14 text-center"
        style={{ border: "2px dashed color-mix(in srgb, var(--color-text) 18%, transparent)" }}
      >
        <h4 className="m-0">Nothing submitted yet</h4>
        <p className="m-0 max-w-[44ch] text-sm" style={{ opacity: 0.7 }}>
          Applications you submit with this wallet will appear here.
        </p>
        <Link href="/apply" className="btn-primary mt-1.5">
          Apply for a grant
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <NotifyToggle />

      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
        {applications.map((application) => (
          <Link
            key={application.id}
            href={`/applications/${application.id}`}
            className="card elev-sm transition-transform duration-200 hover:-translate-y-[3px] hover:shadow-md"
            style={{ padding: 22, gap: 12 }}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="m-0 font-heading text-[18px] leading-tight">{application.projectName}</p>
                <p className="m-0 mt-0.5 text-[12px]" style={{ opacity: 0.6 }}>
                  Submitted {new Date(application.createdAt).toLocaleDateString()}
                </p>
              </div>
              <span className={STATUS_TAG[application.status] ?? "tag tag-neutral"}>
                {STATUS_LABEL[application.status] ?? application.status}
              </span>
            </div>

            <div className="flex items-baseline gap-2 text-[13px]">
              <strong>{formatUnits(BigInt(application.requestedAmount), 6)} USDC</strong>
              <span style={{ opacity: 0.55 }}>
                across {(application.approvedMilestones ?? application.proposedMilestones).length} milestones
              </span>
            </div>

            {application.status === "funded" && application.grantId && (
              <p className="m-0 text-[12.5px]" style={{ color: "var(--color-accent)" }}>
                Escrowed as grant #{application.grantId} — claim your milestones →
              </p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
