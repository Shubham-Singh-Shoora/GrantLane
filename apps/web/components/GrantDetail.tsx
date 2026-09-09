"use client";

import { useAccount } from "wagmi";
import { EscrowStatus, type GrantView } from "./EscrowStatus";
import { MilestoneCard, type MilestoneView } from "./MilestoneCard";
import { PayoutWalletPanel } from "./PayoutWalletPanel";

export function GrantDetail({
  grant,
  milestones,
  escrowAddress,
}: {
  grant: GrantView;
  milestones: MilestoneView[];
  escrowAddress: `0x${string}`;
}) {
  const { address } = useAccount();
  const isGrantee = !!address && address.toLowerCase() === grant.grantee.toLowerCase();

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-slate-100">Grant #{grant.grantId}</h1>
        {!isGrantee && <p className="text-xs text-muted">Connect the grantee wallet to submit evidence.</p>}
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          {milestones.map((milestone) => (
            <MilestoneCard
              key={milestone.milestoneId}
              grantId={grant.grantId}
              escrowAddress={escrowAddress}
              milestone={milestone}
              isGrantee={isGrantee}
            />
          ))}
        </div>

        <div className="space-y-6">
          <EscrowStatus grant={grant} />
          <PayoutWalletPanel
            grantId={grant.grantId}
            escrowAddress={escrowAddress}
            currentPayoutWallet={grant.payoutWallet}
            isGrantee={isGrantee}
          />
        </div>
      </div>
    </div>
  );
}
