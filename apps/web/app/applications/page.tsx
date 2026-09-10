import Link from "next/link";
import { GranterOnly } from "@/components/GranterOnly";
import { formatUnits } from "viem";
import { listApplications, type Application } from "@/lib/applications";
import { hasDurableStore } from "@/lib/kv";

export const dynamic = "force-dynamic";

const STATUS_TAG: Record<Application["status"], string> = {
  submitted: "tag tag-accent",
  approved: "tag tag-accent-2",
  funded: "tag tag-accent-2",
  declined: "tag tag-neutral",
};

const STATUS_LABEL: Record<Application["status"], string> = {
  submitted: "Needs review",
  approved: "Scope agreed",
  funded: "Funded",
  declined: "Declined",
};

export default async function ApplicationsPage() {
  const applications = await listApplications();
  const needsReview = applications.filter((a) => a.status === "submitted").length;

  return (
    <GranterOnly>
    <div className="animate-rise">
      <div className="flex flex-wrap items-end gap-4 pb-5 pt-6">
        <div className="min-w-0 flex-1 basis-[320px]">
          <p className="card-kicker m-0">Granter</p>
          <h1 className="mb-2 mt-1 text-[40px]">Applications</h1>
          <p className="m-0 max-w-[58ch] text-[15px]" style={{ opacity: 0.7 }}>
            Every application here was filled in by a verified human — a Selfie Check runs before submission, so this
            queue is builders rather than scripts.
          </p>
        </div>
        <Link href="/apply" className="btn-secondary font-body font-semibold">
          Open the applicant form
        </Link>
      </div>

      {/* Deploying without Redis means every application vanishes on the next
          cold start — loud here rather than discovered later. */}
      {process.env.NODE_ENV === "production" && !hasDurableStore() && (
        <div
          className="mb-4 rounded-[20px] px-4 py-3.5 text-[13px]"
          style={{ background: "color-mix(in srgb, var(--color-accent) 14%, transparent)" }}
        >
          <strong>No durable store configured.</strong> Applications are being written to a filesystem that this host
          does not persist — they will disappear. Set <span className="mono">KV_REST_API_URL</span> and{" "}
          <span className="mono">KV_REST_API_TOKEN</span> (see DEPLOYMENT.md).
        </div>
      )}

      {applications.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-[32px] px-7 py-14 text-center"
          style={{ border: "2px dashed color-mix(in srgb, var(--color-text) 18%, transparent)" }}
        >
          <h4 className="m-0">No applications yet</h4>
          <p className="m-0 max-w-[44ch] text-sm" style={{ opacity: 0.7 }}>
            Applications appear here once someone submits one. Every applicant passes a Selfie Check first.
          </p>
          <Link href="/apply" className="btn-primary mt-1.5">
            Apply for a grant
          </Link>
        </div>
      ) : (
        <>
          {needsReview > 0 && (
            <p className="m-0 mb-4 text-[13px]" style={{ opacity: 0.7 }}>
              {needsReview} awaiting your decision.
            </p>
          )}
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
                    {application.organisation && (
                      <p className="m-0 mt-0.5 text-[13px]" style={{ opacity: 0.65 }}>
                        {application.organisation}
                      </p>
                    )}
                  </div>
                  <span className={STATUS_TAG[application.status]}>{STATUS_LABEL[application.status]}</span>
                </div>

                <p className="m-0 line-clamp-3 text-[13px]" style={{ opacity: 0.75 }}>
                  {application.pitch}
                </p>

                <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ opacity: 0.65 }}>
                  {application.humanVerified && (
                    <span className="tag tag-accent-2" style={{ fontSize: 10 }}>
                      ✓ Human verified
                    </span>
                  )}
                  {application.repo && <span className="mono">{application.repo.fullName}</span>}
                </div>

                <div className="flex items-baseline gap-2 text-[13px]">
                  <strong>{formatUnits(BigInt(application.requestedAmount), 6)} USDC</strong>
                  <span style={{ opacity: 0.55 }}>
                    across {(application.approvedMilestones ?? application.proposedMilestones).length} milestones
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
    </GranterOnly>
  );
}
