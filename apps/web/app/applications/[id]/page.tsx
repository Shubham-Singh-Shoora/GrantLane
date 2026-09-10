import Link from "next/link";
import { notFound } from "next/navigation";
import { formatUnits } from "viem";
import { getApplication } from "@/lib/applications";
import { grantEscrowAddress, usdcAddress } from "@/lib/contracts";
import { GithubRepoCard } from "@/components/GithubRepoCard";
import { ReviewPanel } from "@/components/ReviewPanel";
import { SetupNotice } from "@/components/SetupNotice";
import { shortAddress } from "@/lib/status";

export const dynamic = "force-dynamic";

const STATUS_LABEL = {
  submitted: "Needs review",
  approved: "Scope agreed",
  funded: "Funded",
  declined: "Declined",
} as const;

export default function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { submitted?: string };
}) {
  const application = getApplication(params.id);
  if (!application) notFound();

  const milestones = application.approvedMilestones ?? application.proposedMilestones;

  let escrow: `0x${string}`;
  let usdc: `0x${string}`;
  try {
    escrow = grantEscrowAddress();
    usdc = usdcAddress();
  } catch (cause) {
    return <SetupNotice detail={String(cause instanceof Error ? cause.message : cause)} />;
  }

  return (
    <div className="animate-rise">
      <Link href="/applications" className="btn-ghost mb-2.5 mt-4 inline-flex" style={{ paddingLeft: 0 }}>
        ← All applications
      </Link>

      {searchParams.submitted === "1" && (
        <div
          className="mb-4 rounded-[20px] px-4 py-3.5 text-[13.5px]"
          style={{ background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)" }}
        >
          <strong>Application submitted.</strong> A granter will review it and set the milestones they&apos;re willing
          to escrow. You&apos;ll verify again when you claim your first milestone.
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 pb-6">
        <div className="min-w-0 flex-1 basis-[340px]">
          <div className="mb-2 flex flex-wrap items-center gap-2.5">
            <span className={application.status === "declined" ? "tag tag-neutral" : "tag tag-accent-2"}>
              {STATUS_LABEL[application.status]}
            </span>
            {application.humanVerified && <span className="tag tag-accent-2">✓ Human verified</span>}
          </div>
          <h1 className="mb-2 text-[38px]">{application.projectName}</h1>
          {application.organisation && (
            <p className="m-0 text-[15px]" style={{ opacity: 0.7 }}>
              {application.organisation}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="m-0 font-heading text-[30px] leading-[1.1]">
            {formatUnits(BigInt(application.requestedAmount), 6)}
          </p>
          <p className="m-0 mt-0.5 text-[13px]" style={{ opacity: 0.6 }}>
            USDC requested
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-1 basis-[460px] flex flex-col gap-4">
          <section className="card elev-sm" style={{ padding: 22, gap: 12 }}>
            <h4 className="m-0">The pitch</h4>
            <p className="m-0 whitespace-pre-wrap text-[14px]" style={{ opacity: 0.85 }}>
              {application.pitch}
            </p>
          </section>

          {(application.website || application.repo) && (
            <section className="card elev-sm" style={{ padding: 22, gap: 12 }}>
              <h4 className="m-0">The work so far</h4>
              {application.website && (
                <p className="m-0 text-[13px]">
                  <span className="kicker">Website</span>
                  <br />
                  <a href={application.website} target="_blank" rel="noreferrer noopener" className="break-all">
                    {application.website}
                  </a>
                </p>
              )}
              {application.repo && <GithubRepoCard repo={application.repo} />}
            </section>
          )}

          <section className="card elev-sm" style={{ padding: 22, gap: 12 }}>
            <h4 className="m-0">Proposed milestones</h4>
            <div className="flex flex-col gap-2.5">
              {milestones.map((m, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-start gap-3 rounded-[18px] p-3.5"
                  style={{ background: "color-mix(in srgb, var(--color-text) 4%, transparent)" }}
                >
                  <span
                    className="grid h-6 w-6 flex-none place-items-center rounded-full text-xs font-bold"
                    style={{ background: "var(--color-accent)", color: "var(--color-bg)" }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-[14px] font-semibold">{m.title}</p>
                    {m.criteria && (
                      <p className="m-0 mt-1 whitespace-pre-wrap text-[12.5px]" style={{ opacity: 0.7 }}>
                        {m.criteria}
                      </p>
                    )}
                  </div>
                  <span className="text-[13px] font-semibold">{formatUnits(BigInt(m.amount), 6)} USDC</span>
                </div>
              ))}
            </div>
          </section>

          {application.reviewNote && (
            <section className="card elev-sm" style={{ padding: 22, gap: 8 }}>
              <h4 className="m-0">Note from the granter</h4>
              <p className="m-0 whitespace-pre-wrap text-[13.5px]" style={{ opacity: 0.8 }}>
                {application.reviewNote}
              </p>
            </section>
          )}
        </div>

        <aside className="flex min-w-0 max-w-[420px] flex-1 basis-[340px] flex-col gap-4">
          <section className="card elev-sm" style={{ padding: 22, gap: 10 }}>
            <h4 className="m-0">Applicant</h4>
            <div>
              <p className="kicker m-0">Payout wallet</p>
              <p className="mono m-0 mt-0.5 break-all text-[12.5px]" title={application.wallet}>
                {shortAddress(application.wallet, 14, 8)}
              </p>
            </div>
            <div>
              <p className="kicker m-0">Proof of humanity</p>
              <p className="m-0 mt-0.5 text-[13px]">
                {application.humanVerified ? (
                  <>
                    Selfie Check passed{" "}
                    {application.verifiedAt && new Date(application.verifiedAt).toLocaleString()}
                  </>
                ) : (
                  "Not verified"
                )}
              </p>
            </div>
            {application.grantId && (
              <div>
                <p className="kicker m-0">On-chain grant</p>
                <Link href={`/grant/${application.grantId}`} className="text-[13px] font-semibold">
                  Grant #{application.grantId} →
                </Link>
              </div>
            )}
          </section>

          {application.status !== "declined" && (
            <ReviewPanel application={application} escrowAddress={escrow} usdcAddress={usdc} />
          )}
        </aside>
      </div>
    </div>
  );
}
