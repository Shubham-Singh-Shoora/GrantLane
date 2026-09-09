import Link from "next/link";
import { formatUsdc, readGrant, readGrantCount, readMilestones, MILESTONE_STATUS } from "@/lib/contracts";
import { SetupNotice } from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

type Row = {
  grantId: string;
  grantee: string;
  total: bigint;
  released: bigint;
  active: boolean;
  milestoneSummary: string;
};

async function loadGrants(): Promise<Row[]> {
  const count = await readGrantCount();
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));

  return Promise.all(
    ids.map(async (grantId) => {
      const [grant, milestones] = await Promise.all([readGrant(grantId), readMilestones(grantId)]);
      const paid = milestones.filter((m) => Number(m.status) === 4).length;
      return {
        grantId: grantId.toString(),
        grantee: grant.grantee,
        total: grant.totalAmount,
        released: grant.releasedAmount,
        active: grant.active,
        milestoneSummary: `${paid}/${milestones.length} paid`,
      };
    }),
  );
}

export default async function HomePage() {
  let rows: Row[];
  try {
    rows = await loadGrants();
  } catch (cause) {
    return <SetupNotice detail={String(cause instanceof Error ? cause.message : cause)} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Grants</h1>
        <p className="mt-1 text-sm text-muted">
          Milestone evidence is scored confidentially inside a CRE TEE. Approved milestones release USDC from escrow on
          Arc without a reviewer ever seeing the raw submission.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="panel p-6 text-sm text-muted">
          No grants yet. Create one by calling <code className="text-slate-200">createGrant</code> on GrantEscrow.
        </div>
      ) : (
        <div className="panel divide-y divide-edge">
          {rows.map((row) => (
            <Link
              key={row.grantId}
              href={`/grant/${row.grantId}`}
              className="flex items-center gap-4 px-5 py-4 transition hover:bg-white/5"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-100">Grant #{row.grantId}</p>
                <p className="truncate font-mono text-xs text-muted">{row.grantee}</p>
              </div>
              <div className="text-right">
                <p className="text-sm text-slate-200">
                  {formatUsdc(row.released)} / {formatUsdc(row.total)} USDC
                </p>
                <p className="text-xs text-muted">{row.milestoneSummary}</p>
              </div>
              <span
                className={
                  row.active ? "chip bg-accent/10 text-accent ring-accent/40" : "chip bg-white/5 text-muted ring-edge"
                }
              >
                {row.active ? "Active" : "Closed"}
              </span>
            </Link>
          ))}
        </div>
      )}

      <p className="text-xs text-muted">
        Milestone states: {MILESTONE_STATUS.join(" → ")}
      </p>
    </div>
  );
}
