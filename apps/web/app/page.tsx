import Link from "next/link";
import { readGrant, readGrantCount, readMilestones } from "@/lib/contracts";
import { listApplications } from "@/lib/applications";
import { statusName } from "@/lib/status";
import { Dashboard, type DashboardData } from "@/components/Dashboard";
import { SetupNotice } from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

/**
 * The landing page is the dashboard.
 *
 * Everything on it is read live — escrow totals and milestone states from Arc,
 * the application queue from the off-chain store. Nothing here is illustrative.
 */
async function loadDashboard(): Promise<DashboardData> {
  const count = await readGrantCount();
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));

  const grants = await Promise.all(
    ids.map(async (grantId) => {
      const [grant, milestones] = await Promise.all([readGrant(grantId), readMilestones(grantId)]);
      return { grantId: grantId.toString(), grant, milestones };
    }),
  );

  let escrowed = 0n;
  let released = 0n;
  const pipeline = { Pending: 0, Submitted: 0, Approved: 0, Rejected: 0, Paid: 0 } as Record<string, number>;
  const recent: DashboardData["recent"] = [];

  for (const { grantId, grant, milestones } of grants) {
    escrowed += grant.totalAmount;
    released += grant.releasedAmount;

    milestones.forEach((m, index) => {
      const name = statusName(Number(m.status));
      pipeline[name] = (pipeline[name] ?? 0) + 1;

      if (Number(m.status) === 1 || Number(m.status) === 4 || Number(m.status) === 3) {
        recent.push({
          grantId,
          milestoneId: index,
          status: Number(m.status),
          amount: m.amount.toString(),
          scoreBps: Number(m.scoreBps),
        });
      }
    });
  }

  // In-flight first, then settled — the things needing attention lead.
  recent.sort((a, b) => (a.status === 1 ? -1 : b.status === 1 ? 1 : b.milestoneId - a.milestoneId));

  const applications = listApplications();

  return {
    escrowed: escrowed.toString(),
    released: released.toString(),
    grantCount: grants.length,
    milestoneCount: Object.values(pipeline).reduce((a, b) => a + b, 0),
    awaitingReport: pipeline.Submitted ?? 0,
    pipeline,
    recent: recent.slice(0, 6),
    applications: {
      total: applications.length,
      needsReview: applications.filter((a) => a.status === "submitted").length,
      funded: applications.filter((a) => a.status === "funded").length,
      latest: applications.slice(0, 3).map((a) => ({
        id: a.id,
        projectName: a.projectName,
        organisation: a.organisation,
        status: a.status,
        requestedAmount: a.requestedAmount,
        humanVerified: a.humanVerified,
      })),
    },
  };
}

export default async function HomePage() {
  let data: DashboardData;
  try {
    data = await loadDashboard();
  } catch (cause) {
    return (
      <>
        <div className="pb-4 pt-6">
          <h1 className="mb-2 text-[40px]">GrantLane</h1>
          <p className="m-0 max-w-[60ch] text-[15px]" style={{ opacity: 0.7 }}>
            Milestone grant escrow with confidential review.
          </p>
        </div>
        <SetupNotice detail={String(cause instanceof Error ? cause.message : cause)} />
        <p className="mt-4 text-[13px]" style={{ opacity: 0.7 }}>
          The <Link href="/apply">application flow</Link> works without a deployed contract — it only needs World ID.
        </p>
      </>
    );
  }

  return <Dashboard data={data} />;
}

