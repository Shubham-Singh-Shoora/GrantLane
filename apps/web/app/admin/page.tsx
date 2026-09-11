import Link from "next/link";
import { GranterOnly } from "@/components/GranterOnly";
import {
  formatUsdc,
  grantEscrowAbi,
  grantEscrowAddress,
  publicClient,
  readEscrowTerms,
  readGrant,
  readGrantCount,
  readMilestones,
  settlementReceiverAddress,
  STATUS,
} from "@/lib/contracts";
import { CHAIN_ID } from "@/lib/chain";
import { formatDuration, shortAddress, statusName, statusTagClass } from "@/lib/status";
import { SetupNotice } from "@/components/SetupNotice";
import { ConfigDisclosure } from "@/components/ConfigDisclosure";

export const dynamic = "force-dynamic";

const ZERO_HASH = `0x${"0".repeat(64)}`;

type MilestoneRow = {
  grantId: string;
  milestoneId: number;
  grantee: string;
  amount: bigint;
  status: number;
  expiresAt: number;
  evidenceHash: string;
};

async function loadBoard() {
  const address = grantEscrowAddress();

  const [count, attestor, oracle, terms] = await Promise.all([
    readGrantCount(),
    publicClient.readContract({ address, abi: grantEscrowAbi, functionName: "attestor" }) as Promise<string>,
    publicClient.readContract({ address, abi: grantEscrowAbi, functionName: "oracle" }) as Promise<string>,
    readEscrowTerms(),
  ]);

  const rows: MilestoneRow[] = [];
  let escrowed = 0n;
  let released = 0n;

  for (let i = 0n; i < count; i++) {
    const [grant, milestones] = await Promise.all([readGrant(i), readMilestones(i)]);
    escrowed += grant.totalAmount;
    released += grant.releasedAmount;

    milestones.forEach((m, idx) => {
      rows.push({
        grantId: i.toString(),
        milestoneId: idx,
        grantee: grant.grantee,
        amount: m.amount,
        status: Number(m.status),
        expiresAt: Number(m.expiresAt),
        evidenceHash: m.evidenceHash,
      });
    });
  }

  // Live claims and disputes first — they're the ones with a clock or a decision pending.
  const live = (s: number) => s === STATUS.Claimed || s === STATUS.Disputed;
  rows.sort((a, b) => (live(a.status) === live(b.status) ? a.status - b.status : live(a.status) ? -1 : 1));

  return { address, attestor, oracle, terms, rows, escrowed, released };
}

function windowLabel(row: MilestoneRow, now: number): string {
  if (row.status === STATUS.Claimed) {
    const left = row.expiresAt - now;
    return left > 0 ? `closes in ${Math.ceil(left / 60)} min` : "closed · ready to settle";
  }
  if (row.status === STATUS.Disputed) return "with UMA";
  return "—";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card elev-sm" style={{ padding: "18px 20px", gap: 2 }}>
      <p className="card-kicker m-0">{label}</p>
      <p className="m-0 font-heading text-[26px] leading-[1.15]">{value}</p>
    </div>
  );
}

export default async function AdminPage() {
  let board: Awaited<ReturnType<typeof loadBoard>>;
  try {
    board = await loadBoard();
  } catch (cause) {
    return <SetupNotice detail={String(cause instanceof Error ? cause.message : cause)} />;
  }

  const now = Math.floor(Date.now() / 1000);
  const open = board.rows.filter((r) => r.status === STATUS.Claimed || r.status === STATUS.Disputed).length;
  const disputes = board.rows.filter((r) => r.status === STATUS.Disputed).length;
  const receiver = settlementReceiverAddress();

  return (
    <GranterOnly>
    <div className="animate-rise">
      <div className="pb-5 pt-6">
        <h1 className="mb-2 text-[40px]">Review queue</h1>
        <p className="m-0 max-w-[62ch] text-[15px]" style={{ opacity: 0.7 }}>
          Nobody approves milestones by hand. A claim pays out unless someone disputes it inside its window; a dispute
          goes to UMA, and whoever is wrong loses their bond. To dispute a claim, open its grant. This page is the audit
          trail.
        </p>
      </div>

      <div className="mb-5 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Stat label="Total escrowed" value={`${formatUsdc(board.escrowed)} USDC`} />
        <Stat label="Released" value={`${formatUsdc(board.released)} USDC`} />
        <Stat label="Open claims" value={String(open)} />
        <Stat label="In dispute" value={String(disputes)} />
      </div>

      <div className="card elev-sm overflow-x-auto" style={{ padding: "6px 6px 2px", gap: 0 }}>
        <table className="table" style={{ minWidth: 680 }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Recipient</th>
              <th>Milestone</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Window</th>
              <th style={{ textAlign: "right", paddingRight: 16 }}>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row) => (
              <tr key={`${row.grantId}-${row.milestoneId}`}>
                <td style={{ paddingLeft: 16 }}>
                  <Link href={`/grant/${row.grantId}`} className="font-semibold" style={{ color: "var(--color-accent)" }}>
                    Grant #{row.grantId}
                  </Link>
                  <p className="mono m-0 mt-px text-xs" style={{ opacity: 0.55 }}>
                    {shortAddress(row.grantee, 10, 6)}
                  </p>
                </td>
                <td style={{ opacity: 0.8 }}>{row.milestoneId + 1}</td>
                <td className="font-semibold">{formatUsdc(row.amount)}</td>
                <td>
                  <span className={statusTagClass(row.status)}>{statusName(row.status)}</span>
                </td>
                <td className="text-[13px]" style={{ opacity: 0.8 }}>
                  {windowLabel(row, now)}
                </td>
                <td className="mono" style={{ textAlign: "right", paddingRight: 16, fontSize: 12 }}>
                  {row.evidenceHash === ZERO_HASH ? (
                    <span style={{ opacity: 0.6 }}>—</span>
                  ) : (
                    <Link href={`/evidence/${row.evidenceHash}`} style={{ color: "var(--color-accent)" }}>
                      {row.evidenceHash.slice(0, 10)}…
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {board.rows.length === 0 && (
              <tr>
                <td colSpan={6} className="text-sm" style={{ padding: "24px 16px", opacity: 0.6 }}>
                  No milestones yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ConfigDisclosure
        cards={[
          { label: "GrantEscrow", value: board.address, hint: `Base Sepolia · chain ${CHAIN_ID}` },
          { label: "UMA Optimistic Oracle V3", value: board.oracle, hint: "Claims are asserted here; anyone can dispute" },
          ...(receiver
            ? [{ label: "SettlementReceiver", value: receiver, hint: "The CRE settlement workflow writes through this" }]
            : []),
          { label: "Attestor", value: board.attestor, hint: "Signs verified Selfie Check attestations" },
          {
            label: "Bond · dispute window",
            value: `${formatUsdc(board.terms.bond)} USDC · ${formatDuration(Number(board.terms.liveness))}`,
            hint: "Posted by the claimant, matched by a disputer",
          },
        ]}
      />
    </div>
    </GranterOnly>
  );
}
