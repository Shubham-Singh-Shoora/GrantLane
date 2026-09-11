import { notFound } from "next/navigation";
import { grantEscrowAddress, readEscrowTerms, readGrant, readMilestones, usdcAddress } from "@/lib/contracts";
import { GrantDetail } from "@/components/GrantDetail";
import { SetupNotice } from "@/components/SetupNotice";
import { milestonesForGrant } from "@/lib/applications";

export const dynamic = "force-dynamic";

export default async function GrantPage({ params }: { params: { id: string } }) {
  if (!/^\d+$/.test(params.id)) notFound();

  const grantId = BigInt(params.id);

  try {
    const escrowAddress = grantEscrowAddress();
    const [grant, milestones, escrowTerms] = await Promise.all([
      readGrant(grantId),
      readMilestones(grantId),
      readEscrowTerms(),
    ]);
    const metadata = await milestonesForGrant(params.id, escrowAddress);

    return (
      <GrantDetail
        terms={{
          escrowAddress,
          usdcAddress: usdcAddress(),
          bond: escrowTerms.bond.toString(),
          liveness: escrowTerms.liveness.toString(),
        }}
        grant={{
          grantId: params.id,
          funder: grant.funder,
          grantee: grant.grantee,
          payoutWallet: grant.payoutWallet,
          totalAmount: grant.totalAmount.toString(),
          releasedAmount: grant.releasedAmount.toString(),
          openClaims: Number(grant.openClaims),
          active: grant.active,
          termsHash: grant.termsHash,
        }}
        milestones={milestones.map((m, i) => ({
          milestoneId: i,
          amount: m.amount.toString(),
          status: Number(m.status),
          expiresAt: m.expiresAt.toString(),
          assertionId: m.assertionId,
          evidenceHash: m.evidenceHash,
          // Titles and criteria live off-chain in the funded application; the
          // contract holds the amounts and a hash of these terms.
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
