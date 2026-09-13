import Link from "next/link";
import { notFound } from "next/navigation";
import type { Hex } from "viem";
import { getDisputeBundle } from "@/lib/store";
import { hashDispute } from "@/lib/commitments";
import { disputeRegistryAbi, disputeRegistryAddress, grantEscrowAddress, publicClient } from "@/lib/contracts";
import { milestonesForGrant } from "@/lib/applications";
import { UMA_OOV3_ADDRESS, umaAssertionAbi } from "@/lib/uma";
import { shortAddress } from "@/lib/status";

export const dynamic = "force-dynamic";

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "tag tag-accent-2" : "tag tag-accent"}>
      {ok ? "✓" : "✕"} {label}
    </span>
  );
}

type OnChainRecord = { disputer: string; filedAt: number; assertionId: Hex };
type Outcome = "awaiting" | "grantee" | "disputer" | "unknown";

/**
 * The page a dispute's on-chain record links to.
 *
 * It shows why someone disputed a claim, and — whatever UMA decided — keeps showing it.
 * Like the evidence page, it doesn't ask to be trusted: it recomputes the reason's hash
 * and looks for that hash in DisputeRegistry's on-chain record for the milestone.
 */
export default async function DisputePage({ params }: { params: { hash: string } }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(params.hash)) notFound();
  const hash = params.hash.toLowerCase() as Hex;
  const bundle = await getDisputeBundle(hash);

  if (!bundle) {
    return (
      <div className="animate-rise pb-10 pt-6">
        <h1 className="mb-3 text-[36px]">Dispute</h1>
        <div className="card elev-sm" style={{ padding: 22 }}>
          <p className="m-0 text-[14px]" style={{ opacity: 0.8 }}>
            No dispute reason is stored under <span className="mono break-all">{hash}</span> on this deployment.
          </p>
        </div>
      </div>
    );
  }

  const bundleMatches = hashDispute(bundle).toLowerCase() === hash;

  let record: OnChainRecord | null = null;
  let outcome: Outcome = "unknown";
  const registry = disputeRegistryAddress();
  if (registry) {
    try {
      const disputes = await publicClient.readContract({
        address: registry,
        abi: disputeRegistryAbi,
        functionName: "disputesFor",
        args: [BigInt(bundle.grantId), BigInt(bundle.milestoneId)],
      });
      const hit = disputes.find((d) => d.reasonHash.toLowerCase() === hash);
      if (hit) {
        record = { disputer: hit.disputer, filedAt: Number(hit.filedAt), assertionId: hit.assertionId };
        const assertion = await publicClient.readContract({
          address: UMA_OOV3_ADDRESS,
          abi: umaAssertionAbi,
          functionName: "getAssertion",
          args: [hit.assertionId],
        });
        outcome = !assertion.settled ? "awaiting" : assertion.settlementResolution ? "grantee" : "disputer";
      }
    } catch {
      record = null;
    }
  }

  let criteria: { title: string; criteria: string } | undefined;
  try {
    criteria = (await milestonesForGrant(bundle.grantId, grantEscrowAddress()))?.[bundle.milestoneId];
  } catch {
    criteria = undefined;
  }

  const outcomeTag =
    outcome === "grantee" ? (
      <span className="tag tag-accent-2">Grantee was right — claim upheld</span>
    ) : outcome === "disputer" ? (
      <span className="tag tag-accent">Disputer was right — claim rejected</span>
    ) : outcome === "awaiting" ? (
      <span className="tag tag-neutral">Awaiting UMA&apos;s decision</span>
    ) : null;

  return (
    <div className="animate-rise pb-10">
      <Link href={`/grant/${bundle.grantId}`} className="btn-ghost mb-2.5 mt-4 inline-flex" style={{ paddingLeft: 0 }}>
        ← Grant #{bundle.grantId}
      </Link>

      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <h1 className="m-0 text-[36px]">
          Dispute · milestone {bundle.milestoneId + 1}
          {criteria?.title ? ` — ${criteria.title}` : ""}
        </h1>
        {outcomeTag}
      </div>

      <div className="mb-5 flex flex-wrap gap-2">
        <Check ok={bundleMatches} label={bundleMatches ? "Reason matches its hash" : "Reason does not match its hash"} />
        <Check
          ok={!!record}
          label={record ? "Recorded on-chain with the dispute" : "Not found in the on-chain dispute record"}
        />
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <section className="card elev-sm min-w-0 flex-1 basis-[440px]" style={{ padding: 22, gap: 14 }}>
          <h4 className="m-0">Why the claim was disputed</h4>
          <p className="m-0 whitespace-pre-wrap text-[14.5px]" style={{ opacity: 0.85 }}>
            {bundle.reason}
          </p>

          {bundle.links.length > 0 && (
            <>
              <div className="rule my-0.5" />
              <p className="kicker m-0">Links offered as proof</p>
              <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                {bundle.links.map((url) => (
                  <li key={url} className="min-w-0">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mono block break-all text-[12.5px]"
                      style={{ color: "var(--color-accent)" }}
                    >
                      {url}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="m-0 text-[12px]" style={{ opacity: 0.55 }}>
            {record
              ? `Filed by ${shortAddress(record.disputer)} on ${new Date(record.filedAt * 1000).toUTCString()}`
              : `Written ${new Date(bundle.submittedAt).toUTCString()}`}
          </p>
        </section>

        <aside className="flex min-w-0 max-w-[400px] flex-1 basis-[300px] flex-col gap-4">
          <section className="card elev-sm" style={{ padding: 22, gap: 10 }}>
            <h4 className="m-0">What the milestone required</h4>
            <p className="m-0 whitespace-pre-wrap text-[13.5px]" style={{ opacity: 0.8 }}>
              {criteria?.criteria || "This grant's terms aren't stored on this deployment. Its terms hash is on-chain."}
            </p>
          </section>

          <section className="card elev-sm" style={{ padding: 22, gap: 10 }}>
            <h4 className="m-0">Record</h4>
            <dl className="m-0 flex flex-col gap-2.5">
              <div className="min-w-0">
                <dt className="kicker">Reason hash</dt>
                <dd className="mono m-0 mt-0.5 break-all text-xs">{hash}</dd>
              </div>
              <div className="min-w-0">
                <dt className="kicker">Disputed UMA assertion</dt>
                <dd className="mono m-0 mt-0.5 break-all text-xs">{bundle.assertionId}</dd>
              </div>
              {record && (
                <div className="min-w-0">
                  <dt className="kicker">Disputer</dt>
                  <dd className="mono m-0 mt-0.5 break-all text-xs">{record.disputer}</dd>
                </div>
              )}
            </dl>
            <p className="m-0 text-[12px]" style={{ opacity: 0.6 }}>
              The reason hash is keccak256 of this reason as canonical JSON. DisputeRegistry stores it on-chain in the
              same transaction that raised the dispute on UMA, and keeps it whatever the outcome.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
