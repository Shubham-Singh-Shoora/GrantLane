"use client";

import Link from "next/link";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { formatUsdc, STATUS, type EscrowTerms } from "@/lib/contracts";
import { formatDuration, shortAddress } from "@/lib/status";
import { EscrowStatus, type GrantView } from "./EscrowStatus";
import { MilestoneCard, type MilestoneView } from "./MilestoneCard";
import { PayoutWalletPanel } from "./PayoutWalletPanel";
import { WithdrawPanel } from "./WithdrawPanel";

export function GrantDetail({
  grant,
  milestones,
  terms,
}: {
  grant: GrantView;
  milestones: MilestoneView[];
  terms: EscrowTerms;
}) {
  const { address } = useAccount();
  const isGrantee = !!address && address.toLowerCase() === grant.grantee.toLowerCase();

  const total = BigInt(grant.totalAmount);
  const released = BigInt(grant.releasedAmount);
  const approved = milestones.filter((m) => m.status === STATUS.Approved).length;

  return (
    <div className="animate-rise">
      <Link href="/" className="btn-ghost mb-2.5 mt-4 inline-flex" style={{ paddingLeft: 0 }}>
        ← All grants
      </Link>

      {isGrantee && (
        <div
          className="my-3.5 flex flex-wrap items-center gap-2.5 rounded-full px-4 py-2.5 text-[12.5px]"
          style={{ background: "color-mix(in srgb, var(--color-accent-2) 16%, transparent)" }}
        >
          <span
            className="h-2 w-2 flex-none rounded-full"
            style={{ background: "var(--color-accent-2)" }}
            aria-hidden
          />
          <span>
            Scoped to your wallet <strong className="mono">{shortAddress(grant.grantee)}</strong> — you can claim
            milestones and change the payout wallet.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4 pb-6">
        <div className="min-w-0 flex-1 basis-[340px]">
          <div className="mb-2 flex flex-wrap items-center gap-2.5">
            <span className="tag tag-neutral mono">#{grant.grantId}</span>
            <span className={grant.active ? "tag tag-accent-2" : "tag tag-neutral"}>
              {grant.active ? "Active" : "Closed"}
            </span>
          </div>
          <h1 className="mb-2 text-[38px]">Grant #{grant.grantId}</h1>
          <p className="m-0 text-[15px]" style={{ opacity: 0.7 }}>
            <span className="mono">{shortAddress(grant.grantee, 10, 6)}</span> ·{" "}
            {isGrantee ? "you are the grantee" : "connect the grantee wallet to claim milestones"}
          </p>
        </div>
        <div className="text-right">
          <p className="m-0 font-heading text-[30px] leading-[1.1]">{formatUsdc(released)}</p>
          <p className="m-0 mt-0.5 text-[13px]" style={{ opacity: 0.6 }}>
            of {formatUsdc(total)} USDC released
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-0 flex-1 basis-[460px]">
          <div className="mb-1.5 flex items-baseline gap-2.5">
            <h3 className="m-0">Milestones</h3>
            <span className="text-[13px]" style={{ opacity: 0.55 }}>
              {approved} of {milestones.length} approved
            </span>
          </div>
          <p className="m-0 mb-3.5 max-w-[62ch] text-[13px]" style={{ opacity: 0.65 }}>
            A claim posts a {formatUsdc(BigInt(terms.bond))} USDC bond and is open to dispute for{" "}
            {formatDuration(Number(terms.liveness))}. Undisputed claims pay out; disputed ones go to UMA, and whoever is
            wrong loses their bond.
          </p>

          {/* The rail runs behind the numbered nodes; each node punches a ring
              of page background so the line appears to pass under it. */}
          <div className="relative pl-[34px]">
            <div
              className="absolute bottom-3 left-[13px] top-3 w-0.5"
              style={{ background: "color-mix(in srgb, var(--color-text) 12%, transparent)" }}
              aria-hidden
            />
            <div className="flex flex-col gap-3">
              {milestones.map((milestone) => (
                <MilestoneCard
                  key={milestone.milestoneId}
                  grantId={grant.grantId}
                  grantee={grant.grantee as Address}
                  terms={terms}
                  milestone={milestone}
                  isGrantee={isGrantee}
                />
              ))}
            </div>
          </div>
        </div>

        <aside className="flex min-w-0 max-w-[380px] flex-1 basis-[300px] flex-col gap-4 pt-[42px]">
          <EscrowStatus grant={grant} terms={terms} />
          <WithdrawPanel escrowAddress={terms.escrowAddress} />
          <PayoutWalletPanel
            grantId={grant.grantId}
            escrowAddress={terms.escrowAddress}
            currentPayoutWallet={grant.payoutWallet}
            isGrantee={isGrantee}
          />
        </aside>
      </div>
    </div>
  );
}
