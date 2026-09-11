import Link from "next/link";
import { formatUsdc, readGrant, readGrantCount, readMilestones, STATUS } from "@/lib/contracts";
import { addressInitials, shortAddress, statusDotFill, statusName } from "@/lib/status";
import { SetupNotice } from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

type Row = {
  grantId: string;
  grantee: string;
  total: bigint;
  released: bigint;
  active: boolean;
  paidCount: number;
  milestoneStatuses: number[];
};

async function loadGrants(): Promise<Row[]> {
  const count = await readGrantCount();
  const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i));

  return Promise.all(
    ids.map(async (grantId) => {
      const [grant, milestones] = await Promise.all([readGrant(grantId), readMilestones(grantId)]);
      return {
        grantId: grantId.toString(),
        grantee: grant.grantee,
        total: grant.totalAmount,
        released: grant.releasedAmount,
        active: grant.active,
        paidCount: milestones.filter((m) => Number(m.status) === STATUS.Approved).length,
        milestoneStatuses: milestones.map((m) => Number(m.status)),
      };
    }),
  );
}

function GrantCard({ row }: { row: Row }) {
  const pct = row.total === 0n ? 0 : Number((row.released * 10_000n) / row.total) / 100;

  return (
    <Link
      href={`/grant/${row.grantId}`}
      className="card elev-sm transition-transform duration-200 hover:-translate-y-[3px] hover:shadow-md"
      style={{ padding: 22, gap: 14 }}
    >
      <div className="flex items-start gap-3">
        <span
          className="grid h-[42px] w-[42px] flex-none place-items-center rounded-full font-heading text-[17px]"
          style={{
            background: "color-mix(in srgb, var(--color-accent) 18%, transparent)",
            color: "var(--color-accent-800)",
          }}
          aria-hidden
        >
          {addressInitials(row.grantee)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-heading text-[18px] leading-tight">Grant #{row.grantId}</p>
          <p className="mono mt-0.5 text-[13px]" style={{ opacity: 0.65 }}>
            {shortAddress(row.grantee, 10, 6)}
          </p>
        </div>
        <span className={row.active ? "tag tag-accent-2" : "tag tag-neutral"}>{row.active ? "Active" : "Closed"}</span>
      </div>

      <div>
        <div className="track h-2">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ background: "var(--color-accent)", width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <div className="mt-2.5 flex gap-2 text-[13px]">
          <span className="font-semibold">{formatUsdc(row.released)}</span>
          <span style={{ opacity: 0.55 }}>of {formatUsdc(row.total)} USDC released</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5">
        {row.milestoneStatuses.map((status, i) => (
          <span
            key={i}
            title={`Milestone ${i + 1}: ${statusName(status)}`}
            className="h-1.5 flex-1 rounded-full"
            style={{ background: statusDotFill(status) }}
          />
        ))}
        <span className="ml-1.5 whitespace-nowrap text-[11px]" style={{ opacity: 0.55 }}>
          {row.paidCount}/{row.milestoneStatuses.length} approved
        </span>
      </div>
    </Link>
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
    <div className="animate-rise">
      <div className="flex flex-wrap items-end gap-4 pb-5 pt-6">
        <div className="min-w-0 flex-1 basis-[300px]">
          <h1 className="mb-2 text-[40px]">Grants</h1>
          <p className="max-w-[56ch] text-[15px]" style={{ opacity: 0.7 }}>
            Every grant is escrowed up front and released milestone by milestone. A milestone pays out when its bonded
            claim survives a dispute window — nobody approves it by hand.
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div
          className="flex flex-col items-center gap-3 rounded-[32px] px-7 py-14 text-center"
          style={{ border: "2px dashed color-mix(in srgb, var(--color-text) 18%, transparent)" }}
        >
          <span
            className="grid h-16 w-16 place-items-center rounded-full"
            style={{ background: "color-mix(in srgb, var(--color-accent) 14%, transparent)" }}
            aria-hidden
          >
            <span
              className="block h-[26px] w-[26px] rounded-full"
              style={{ border: "3px dashed var(--color-accent)" }}
            />
          </span>
          <h4 className="m-0">No grants yet</h4>
          <p className="m-0 max-w-[44ch] text-sm" style={{ opacity: 0.7 }}>
            Grants appear here once an approved application is funded.
          </p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" }}>
          {rows.map((row) => (
            <GrantCard key={row.grantId} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
