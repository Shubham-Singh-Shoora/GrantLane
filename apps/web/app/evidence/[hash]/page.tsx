import Link from "next/link";
import { notFound } from "next/navigation";
import type { Hex } from "viem";
import { getEvidence } from "@/lib/store";
import { hashEvidence, hashTerms } from "@/lib/commitments";
import { grantEscrowAddress, readGrant, readMilestones } from "@/lib/contracts";
import { milestonesForGrant } from "@/lib/applications";
import { statusName, statusTagClass } from "@/lib/status";

export const dynamic = "force-dynamic";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "tag tag-accent-2" : "tag tag-accent"}>
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

/**
 * The page a UMA claim links to.
 *
 * Whoever is deciding whether to dispute a claim — the grantor, anyone watching,
 * or a UMA voter — lands here. It shows the evidence and, rather than asking to be
 * trusted, recomputes the hashes: that this bundle is the one committed on-chain,
 * and that the milestone terms shown are the ones the grant was funded under.
 */
export default async function EvidencePage({ params }: { params: { hash: string } }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(params.hash)) notFound();
  const hash = params.hash.toLowerCase() as Hex;
  const bundle = await getEvidence(hash);

  if (!bundle) {
    return (
      <div className="animate-rise pb-10 pt-6">
        <h1 className="mb-3 text-[36px]">Evidence</h1>
        <div className="card elev-sm" style={{ padding: 22 }}>
          <p className="m-0 text-[14px]" style={{ opacity: 0.8 }}>
            No evidence bundle is stored under <span className="mono break-all">{hash}</span>. Claims sent from the
            command line carry their evidence at the link written in their UMA assertion instead.
          </p>
        </div>
      </div>
    );
  }

  const bundleMatches = hashEvidence(bundle).toLowerCase() === hash;

  let onChain: { status: number; current: boolean; termsHash: Hex } | null = null;
  let terms: Awaited<ReturnType<typeof milestonesForGrant>> = null;
  try {
    const escrow = grantEscrowAddress();
    const [grant, milestones] = await Promise.all([
      readGrant(BigInt(bundle.grantId)),
      readMilestones(BigInt(bundle.grantId)),
    ]);
    const milestone = milestones[bundle.milestoneId];
    if (milestone) {
      onChain = {
        status: Number(milestone.status),
        current: milestone.evidenceHash.toLowerCase() === hash,
        termsHash: grant.termsHash,
      };
    }
    terms = await milestonesForGrant(bundle.grantId, escrow);
  } catch {
    onChain = null;
  }

  const termsMatch = !!terms && !!onChain && hashTerms(terms).toLowerCase() === onChain.termsHash.toLowerCase();
  const milestoneTerms = terms?.[bundle.milestoneId];

  const links = [
    { label: "Live product", url: bundle.liveUrl },
    { label: "Demo video", url: bundle.demoVideoUrl },
    { label: "Repository", url: bundle.repoUrl },
    ...bundle.screenshots.map((url, i) => ({ label: `Screenshot ${i + 1}`, url })),
  ].filter((link): link is { label: string; url: string } => !!link.url);

  return (
    <div className="animate-rise pb-10">
      <Link href={`/grant/${bundle.grantId}`} className="btn-ghost mb-2.5 mt-4 inline-flex" style={{ paddingLeft: 0 }}>
        ← Grant #{bundle.grantId}
      </Link>

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 text-[36px]">
          Evidence · milestone {bundle.milestoneId + 1}
          {milestoneTerms?.title ? ` — ${milestoneTerms.title}` : ""}
        </h1>
        {onChain && <span className={statusTagClass(onChain.status)}>{statusName(onChain.status)}</span>}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Check ok={bundleMatches} label={bundleMatches ? "Bundle matches its hash" : "Bundle does not match its hash"} />
        {onChain && (
          <Check
            ok={onChain.current}
            label={onChain.current ? "This is the claim on-chain now" : "Superseded by a later claim"}
          />
        )}
        {terms && onChain && (
          <Check ok={termsMatch} label={termsMatch ? "Terms match the on-chain commitment" : "Terms do not match"} />
        )}
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section className="card elev-sm min-w-0 flex-1 basis-[440px]" style={{ padding: 22, gap: 14 }}>
          <h4 className="m-0">What the grantee says was delivered</h4>
          <p className="m-0 whitespace-pre-wrap text-[14.5px]" style={{ opacity: 0.85 }}>
            {bundle.summary}
          </p>

          <div className="rule my-0.5" />

          <p className="kicker m-0">Links to check</p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {links.map((link) => (
              <li key={link.label} className="min-w-0">
                <span className="text-[12.5px] font-semibold">{link.label}</span>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mono block break-all text-[12.5px]"
                  style={{ color: "var(--color-accent)" }}
                >
                  {link.url}
                </a>
              </li>
            ))}
          </ul>
          <p className="m-0 text-[12px]" style={{ opacity: 0.55 }}>
            Submitted {new Date(bundle.submittedAt).toUTCString()}
          </p>
        </section>

        <aside className="flex min-w-0 max-w-[400px] flex-1 basis-[300px] flex-col gap-4">
          <section className="card elev-sm" style={{ padding: 22, gap: 10 }}>
            <h4 className="m-0">What the milestone required</h4>
            {milestoneTerms ? (
              <p className="m-0 whitespace-pre-wrap text-[13.5px]" style={{ opacity: 0.8 }}>
                {milestoneTerms.criteria || "No criteria text was set for this milestone."}
              </p>
            ) : (
              <p className="m-0 text-[13px]" style={{ opacity: 0.7 }}>
                This grant was funded outside the app, so its terms aren&apos;t stored here. Its terms hash is still on-chain.
              </p>
            )}
          </section>

          <section className="card elev-sm" style={{ padding: 22, gap: 10 }}>
            <h4 className="m-0">Hashes</h4>
            <dl className="m-0 flex flex-col gap-2.5">
              <div className="min-w-0">
                <dt className="kicker">Evidence hash</dt>
                <dd className="mono m-0 mt-0.5 break-all text-xs">{hash}</dd>
              </div>
              {onChain && (
                <div className="min-w-0">
                  <dt className="kicker">Terms hash on-chain</dt>
                  <dd className="mono m-0 mt-0.5 break-all text-xs">{onChain.termsHash}</dd>
                </div>
              )}
            </dl>
            <p className="m-0 text-[12px]" style={{ opacity: 0.6 }}>
              The evidence hash is keccak256 of this bundle as canonical JSON; the terms hash is the same over the funded
              milestone set. Both are written into the claim on UMA.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
