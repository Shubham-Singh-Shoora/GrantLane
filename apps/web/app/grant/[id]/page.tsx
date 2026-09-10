import { notFound } from "next/navigation";
import { grantEscrowAddress, readGrant, readMilestones } from "@/lib/contracts";
import { GrantDetail } from "@/components/GrantDetail";
import { SetupNotice } from "@/components/SetupNotice";
import { milestonesForGrant } from "@/lib/applications";

export const dynamic = "force-dynamic";

export default async function GrantPage({ params }: { params: { id: string } }) {
  if (!/^\d+$/.test(params.id)) notFound();

  const grantId = BigInt(params.id);

  try {
    const escrowAddress = grantEscrowAddress();
    const [grant, milestones] = await Promise.all([readGrant(grantId), readMilestones(grantId)]);
    const metadata = milestonesForGrant(params.id);

    return (
      <GrantDetail
        escrowAddress={escrowAddress}
        grant={{
          grantId: params.id,
          funder: grant.funder,
          grantee: grant.grantee,
          payoutWallet: grant.payoutWallet,
          token: grant.token,
          totalAmount: grant.totalAmount.toString(),
          releasedAmount: grant.releasedAmount.toString(),
          active: grant.active,
        }}
        milestones={milestones.map((m, i) => ({
          milestoneId: i,
          amount: m.amount.toString(),
          paidAmount: m.paidAmount.toString(),
          status: Number(m.status),
          scoreBps: Number(m.scoreBps),
          evidenceHash: m.evidenceHash,
          // Titles and criteria live off-chain in the funded application; the
          // contract only ever knew the amounts.
          title: metadata?.[i]?.title,
          criteria: metadata?.[i]?.criteria,
        }))}
      />
    );
  } catch (cause) {
    const message = String(cause instanceof Error ? cause.message : cause);
    if (message.includes("UnknownGrant")) notFound();
    return <SetupNotice detail={message} />;
  }
}
