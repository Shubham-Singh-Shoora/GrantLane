"use client";

import Link from "next/link";
import { formatUsdc } from "@/lib/contracts";
import { statusName, statusTagClass } from "@/lib/status";
import { useRole } from "./RoleProvider";

export type DashboardData = {
  escrowed: string;
  released: string;
  grantCount: number;
  milestoneCount: number;
  awaitingReport: number;
  pipeline: Record<string, number>;
  recent: { grantId: string; milestoneId: number; status: number; amount: string; scoreBps: number }[];
  applications: {
    total: number;
    needsReview: number;
    funded: number;
    latest: {
      id: string;
      projectName: string;
      organisation: string;
      status: string;
      requestedAmount: string;
      humanVerified: boolean;
    }[];
  };
};

/** Pipeline segments, in the order work actually moves through them. */
const PIPELINE_ORDER = [
  { key: "Paid", fill: "var(--color-accent-2)" },
  { key: "Approved", fill: "var(--color-accent-2-400)" },
  { key: "Submitted", fill: "var(--color-accent)" },
  { key: "Rejected", fill: "var(--color-accent-400)" },
  { key: "Pending", fill: "color-mix(in srgb, var(--color-text) 14%, transparent)" },
] as const;

/** Unit is set in the body face at a smaller size so the number stays the figure. */
function Stat({ label, value, unit, hint }: { label: string; value: string; unit?: string; hint?: string }) {
  return (
    <div className="card elev-sm" style={{ padding: "18px 20px", gap: 3 }}>
      <p className="card-kicker m-0">{label}</p>
      <p className="m-0 font-heading text-[26px] leading-[1.15]">
        {value}
        {unit && (
          <span className="ml-1 font-body text-[13px] font-semibold" style={{ opacity: 0.5 }}>
            {unit}
          </span>
        )}
      </p>
      <p className="m-0 text-[12px]" style={{ opacity: 0.6, minHeight: 16 }}>
        {hint ?? ""}
      </p>
    </div>
  );
}

export function Dashboard({ data }: { data: DashboardData }) {
  const { role } = useRole();
  const isGranter = role === "granter";

  const escrowed = BigInt(data.escrowed);
  const released = BigInt(data.released);
  const pct = escrowed === 0n ? 0 : Number((released * 10_000n) / escrowed) / 100;
  const totalMilestones = Math.max(data.milestoneCount, 1);

  return (
    <div className="animate-rise">
      {/* — hero — */}
      <section className="flex flex-wrap items-stretch gap-5 pb-7 pt-8">
        <div className="flex min-w-0 flex-1 basis-[340px] flex-col justify-center">
          <p className="card-kicker m-0">{isGranter ? "Fund portfolio" : "Your grants"}</p>
          <h1 className="mb-3 mt-1.5 text-[44px]">
            {isGranter ? "Fund work, not paperwork." : "Get paid for what you shipped."}
          </h1>
          <p className="m-0 max-w-[58ch] text-[15px]" style={{ opacity: 0.75 }}>
            {isGranter
              ? "Escrow a grant once and let it release itself. Evidence is scored inside a sealed enclave — you never read a raw submission, and no key of yours can move the money."
              : "Submit evidence when a milestone is done. A confidential enclave scores it against the agreed criteria and the escrow pays out on Arc — no reviewer reads your submission, and no one has to remember to press pay."}
          </p>

          <div className="mt-5 flex flex-wrap gap-2.5">
            {isGranter ? (
              <>
                <Link href="/applications" className="btn-primary" style={{ fontSize: 15, padding: "11px 22px" }}>
                  Review applications
                  {data.applications.needsReview > 0 && (
                    <span
                      className="ml-1 rounded-full px-2 py-0.5 text-[11px]"
                      style={{ background: "color-mix(in srgb, var(--color-bg) 30%, transparent)" }}
                    >
                      {data.applications.needsReview}
                    </span>
                  )}
                </Link>
                <Link href="/grants" className="btn-secondary font-body font-semibold">
                  Open grants
                </Link>
              </>
            ) : (
              <>
                <Link href="/apply" className="btn-primary" style={{ fontSize: 15, padding: "11px 22px" }}>
                  Apply for a grant
                </Link>
                <Link href="/grants" className="btn-secondary font-body font-semibold">
                  My grants
                </Link>
              </>
            )}
          </div>
        </div>

        {/* — release meter — */}
        <div className="card elev-md min-w-0 flex-1 basis-[300px] justify-center" style={{ padding: 26, gap: 14 }}>
          <p className="card-kicker m-0">Released from escrow</p>
          <p className="m-0 font-heading leading-none">
            <span className="text-[40px]">{formatUsdc(released)}</span>
            <span className="ml-1.5 text-[17px]" style={{ opacity: 0.55 }}>
              USDC
            </span>
          </p>
          <div className="track h-2.5">
            <div
              className="h-full rounded-full transition-[width] duration-700"
              style={{ background: "var(--color-accent)", width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]" style={{ opacity: 0.7 }}>
            <span>of {formatUsdc(escrowed)} escrowed</span>
            <span className="tag tag-accent-2 ml-auto" style={{ fontSize: 11 }}>
              {pct.toFixed(1)}% released
            </span>
          </div>
        </div>
      </section>

      {/* — how it works — the product in one glance — */}
      <section className="mb-6 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
        {[
          {
            step: "01",
            title: "Apply",
            body: "A Selfie Check proves a live human filled it in. Show a site, a repo, and how you'd split the work.",
          },
          {
            step: "02",
            title: "Granter escrows",
            body: "They set the milestone amounts and lock the whole grant on Arc up front.",
          },
          {
            step: "03",
            title: "Ship and claim",
            body: "Verify again, submit evidence. Only a hash goes on-chain; the bundle goes to the enclave.",
          },
          {
            step: "04",
            title: "It pays itself",
            body: "A sealed enclave scores it and a DON-signed report releases the USDC. Nobody presses pay.",
          },
        ].map((item) => (
          <div key={item.step} className="card" style={{ padding: "18px 20px", gap: 8 }}>
            <span
              className="grid h-7 w-7 place-items-center rounded-full font-heading text-[12px]"
              style={{ background: "color-mix(in srgb, var(--color-accent) 18%, transparent)", color: "var(--color-accent)" }}
              aria-hidden
            >
              {item.step}
            </span>
            <p className="m-0 font-heading text-[16px] leading-tight">{item.title}</p>
            <p className="m-0 text-[12.5px]" style={{ opacity: 0.7 }}>
              {item.body}
            </p>
          </div>
        ))}
      </section>

      {/* — stats — */}
      <div className="mb-6 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Stat label="Grants" value={String(data.grantCount)} hint={`${data.milestoneCount} milestones`} />
        <Stat label="Still escrowed" value={formatUsdc(escrowed - released)} unit="USDC" hint="locked on Arc" />
        <Stat label="Awaiting report" value={String(data.awaitingReport)} hint="in confidential scoring" />
        <Stat
          label="Applications"
          value={String(data.applications.total)}
          hint={data.applications.needsReview > 0 ? `${data.applications.needsReview} need review` : "all reviewed"}
        />
      </div>

      {/* — pipeline — */}
      <section className="card elev-sm mb-6" style={{ padding: 22, gap: 14 }}>
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h4 className="m-0">Milestone pipeline</h4>
          <span className="text-[13px]" style={{ opacity: 0.55 }}>
            live from Arc
          </span>
        </div>

        <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--color-text) 8%, transparent)" }}>
          {PIPELINE_ORDER.map((segment) => {
            const count = data.pipeline[segment.key] ?? 0;
            if (count === 0) return null;
            return (
              <span
                key={segment.key}
                title={`${segment.key}: ${count}`}
                style={{ width: `${(count / totalMilestones) * 100}%`, background: segment.fill }}
              />
            );
          })}
        </div>

        <dl className="m-0 flex flex-col gap-1.5">
          {PIPELINE_ORDER.map((segment) => (
            <div key={segment.key} className="flex items-center gap-2 text-[13px]">
              <span className="h-1.5 w-1.5 flex-none rounded-full" style={{ background: segment.fill }} aria-hidden />
              <dt style={{ opacity: 0.75 }}>{segment.key}</dt>
              <dd className="m-0 ml-auto font-semibold">{data.pipeline[segment.key] ?? 0}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* — two columns — */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <section className="card elev-sm" style={{ padding: 22, gap: 12 }}>
          <div className="flex items-baseline gap-2.5">
            <h4 className="m-0">Needs attention</h4>
            <Link href="/grants" className="btn-ghost ml-auto">
              All grants
            </Link>
          </div>

          {data.recent.length === 0 ? (
            <p className="m-0 text-[13px]" style={{ opacity: 0.65 }}>
              Nothing in flight. Milestones appear here once evidence is submitted.
            </p>
          ) : (
            data.recent.map((item) => (
              <Link
                key={`${item.grantId}-${item.milestoneId}`}
                href={`/grant/${item.grantId}`}
                className="flex flex-wrap items-center gap-2.5 rounded-[18px] p-3 transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[14px] font-semibold">
                    Grant #{item.grantId} · Milestone {item.milestoneId + 1}
                  </p>
                  <p className="m-0 mt-0.5 text-[12px]" style={{ opacity: 0.6 }}>
                    {formatUsdc(BigInt(item.amount))} USDC
                    {item.scoreBps > 0 && ` · scored ${(item.scoreBps / 100).toFixed(1)}%`}
                  </p>
                </div>
                <span className={statusTagClass(item.status)}>{statusName(item.status)}</span>
              </Link>
            ))
          )}
        </section>

        <section className="card elev-sm" style={{ padding: 22, gap: 12 }}>
          <div className="flex items-baseline gap-2.5">
            <h4 className="m-0">Applications</h4>
            <Link href={isGranter ? "/applications" : "/apply"} className="btn-ghost ml-auto">
              {isGranter ? "Review queue" : "Apply"}
            </Link>
          </div>

          {data.applications.latest.length === 0 ? (
            <p className="m-0 text-[13px]" style={{ opacity: 0.65 }}>
              No applications yet. Every one has to clear a Selfie Check before it lands here.
            </p>
          ) : (
            data.applications.latest.map((application) => (
              <Link
                key={application.id}
                href={`/applications/${application.id}`}
                className="flex flex-wrap items-center gap-2.5 rounded-[18px] p-3 transition-colors hover:bg-[color-mix(in_srgb,var(--color-text)_4%,transparent)]"
              >
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[14px] font-semibold">{application.projectName}</p>
                  <p className="m-0 mt-0.5 text-[12px]" style={{ opacity: 0.6 }}>
                    {(Number(BigInt(application.requestedAmount)) / 1e6).toLocaleString("en-US")} USDC requested
                  </p>
                </div>
                {application.humanVerified && (
                  <span className="tag tag-accent-2" style={{ fontSize: 10 }}>
                    ✓ Human
                  </span>
                )}
              </Link>
            ))
          )}
        </section>
      </div>

      <p className="mt-6 text-[12px]" style={{ opacity: 0.5 }}>
        Every figure above is read live — escrow and milestone state from Arc Testnet, applications from the local
        store. Nothing here is placeholder data.
      </p>
    </div>
  );
}
