import Link from "next/link";
import {
  formatUsdc,
  grantEscrowAddress,
  publicClient,
  grantEscrowAbi,
  readGrant,
  readGrantCount,
  readMilestones,
} from "@/lib/contracts";
import { shortAddress, statusName, statusTagClass } from "@/lib/status";
import { SetupNotice } from "@/components/SetupNotice";
import { ConfigDisclosure } from "@/components/ConfigDisclosure";

export const dynamic = "force-dynamic";

const ZERO = "0x0000000000000000000000000000000000000000";

type MilestoneRow = {
  grantId: string;
  milestoneId: number;
  grantee: string;
  amount: bigint;
  paidAmount: bigint;
  status: number;
  scoreBps: number;
  evidenceHash: string;
};

async function loadBoard() {
  const address = grantEscrowAddress();

  const [count, forwarder, attestor, expectedAuthor] = await Promise.all([
    readGrantCount(),
    publicClient.readContract({ address, abi: grantEscrowAbi, functionName: "s_forwarderAddress" }) as Promise<string>,
    publicClient.readContract({ address, abi: grantEscrowAbi, functionName: "attestor" }) as Promise<string>,
    publicClient.readContract({ address, abi: grantEscrowAbi, functionName: "s_expectedAuthor" }) as Promise<string>,
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
        paidAmount: m.paidAmount,
        status: Number(m.status),
        scoreBps: Number(m.scoreBps),
        evidenceHash: m.evidenceHash,
      });
    });
  }

  // Awaiting a report first, then everything else.
  rows.sort((a, b) => (a.status === 1 ? -1 : b.status === 1 ? 1 : a.status - b.status));

  return { address, forwarder, attestor, expectedAuthor, rows, escrowed, released };
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

  const awaiting = board.rows.filter((r) => r.status === 1).length;

  return (
    <div className="animate-rise">
      <div className="pb-5 pt-6">
        <h1 className="mb-2 text-[40px]">Review queue</h1>
        <p className="m-0 max-w-[60ch] text-[15px]" style={{ opacity: 0.7 }}>
          Nobody scores submissions here — the workflow does that inside a sealed enclave and its signed report settles
          the payment. This page is the audit trail: what was escrowed, what the workflow decided, what it paid.
        </p>
      </div>

      <div className="mb-5 grid gap-3.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
        <Stat label="Total escrowed" value={`${formatUsdc(board.escrowed)} USDC`} />
        <Stat label="Released" value={`${formatUsdc(board.released)} USDC`} />
        <Stat label="Awaiting report" value={String(awaiting)} />
        <Stat label="Milestones" value={String(board.rows.length)} />
      </div>

      <div className="card elev-sm overflow-x-auto" style={{ padding: "6px 6px 2px", gap: 0 }}>
        <table className="table" style={{ minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ paddingLeft: 16 }}>Recipient</th>
              <th>Milestone</th>
              <th>Amount</th>
              <th>Score</th>
              <th>Status</th>
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
                <td className="font-semibold">
                  {formatUsdc(row.amount)}
                  {row.paidAmount > 0n && (
                    <span style={{ opacity: 0.55 }}> · {formatUsdc(row.paidAmount)} paid</span>
                  )}
                </td>
                <td style={{ opacity: 0.8 }}>{row.scoreBps > 0 ? `${(row.scoreBps / 100).toFixed(1)}%` : "—"}</td>
                <td>
                  <span className={statusTagClass(row.status)}>{statusName(row.status)}</span>
                </td>
                <td className="mono" style={{ textAlign: "right", paddingRight: 16, fontSize: 12, opacity: 0.6 }}>
                  {row.evidenceHash === `0x${"0".repeat(64)}` ? "—" : `${row.evidenceHash.slice(0, 12)}…`}
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
          { label: "GrantEscrow", value: board.address, hint: "Arc Testnet · chain 5042002" },
          { label: "KeystoneForwarder", value: board.forwarder, hint: "Only this address may deliver reports" },
          { label: "Attestor", value: board.attestor, hint: "Signs verified Selfie Check attestations" },
          {
            label: "Expected workflow owner",
            value: board.expectedAuthor === ZERO ? "any" : board.expectedAuthor,
            hint: "Reports from other workflow owners are rejected when set",
          },
        ]}
      />
    </div>
  );
}
