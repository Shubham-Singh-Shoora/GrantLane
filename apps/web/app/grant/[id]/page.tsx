import { notFound } from "next/navigation";
import { grantEscrowAddress, readGrant, readMilestones } from "@/lib/contracts";
import { GrantDetail } from "@/components/GrantDetail";
import { SetupNotice } from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

export default async function GrantPage({ params }: { params: { id: string } }) {
  if (!/^\d+$/.test(params.id)) notFound();

  const grantId = BigInt(params.id);

  try {
    const escrowAddress = grantEscrowAddress();
    const [grant, milestones] = await Promise.all([readGrant(grantId), readMilestones(grantId)]);

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
        }))}
      />
    );
  } catch (cause) {
    const message = String(cause instanceof Error ? cause.message : cause);
    if (message.includes("UnknownGrant")) notFound();
    return <SetupNotice detail={message} />;
  }
}
