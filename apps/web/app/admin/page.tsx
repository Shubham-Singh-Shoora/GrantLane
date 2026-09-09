import Link from "next/link";
import {
  formatUsdc,
  grantEscrowAddress,
  publicClient,
  grantEscrowAbi,
  readGrant,
  readGrantCount,
  readMilestones,
  MILESTONE_STATUS,
} from "@/lib/contracts";
import { SetupNotice } from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

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

function Config({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-4">
      <p className="label">{label}</p>
      <p className="break-all font-mono text-xs text-slate-200">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
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
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-100">Reviewer</h1>
        <p className="mt-1 text-sm text-muted">
          Reviewers do not score submissions here — the CRE workflow does that inside a TEE and the DON-signed report
          settles it. This view is the audit trail: what is escrowed, what the workflow decided, and what it paid.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="panel p-4">
          <p className="label">Total escrowed</p>
          <p className="text-sm text-slate-100">{formatUsdc(board.escrowed)} USDC</p>
        </div>
        <div className="panel p-4">
          <p className="label">Released</p>
          <p className="text-sm text-slate-100">{formatUsdc(board.released)} USDC</p>
        </div>
        <div className="panel p-4">
          <p className="label">Awaiting report</p>
          <p className="text-sm text-slate-100">{awaiting}</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Config label="GrantEscrow" value={board.address} />
        <Config label="KeystoneForwarder" value={board.forwarder} hint="Only this address may deliver reports" />
        <Config label="Attestor" value={board.attestor} hint="Signs verified Selfie Check attestations" />
        <Config
          label="Expected workflow owner"
          value={board.expectedAuthor === "0x0000000000000000000000000000000000000000" ? "any" : board.expectedAuthor}
          hint="Reports from other workflow owners are rejected when set"
        />
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-edge text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Grant</th>
              <th className="px-4 py-3 font-medium">Milestone</th>
              <th className="px-4 py-3 font-medium">Grantee</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Evidence hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-edge">
            {board.rows.map((row) => (
              <tr key={`${row.grantId}-${row.milestoneId}`} className="hover:bg-white/5">
                <td className="px-4 py-3">
                  <Link href={`/grant/${row.grantId}`} className="text-accent hover:underline">
                    #{row.grantId}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-300">{row.milestoneId + 1}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {row.grantee.slice(0, 10)}…{row.grantee.slice(-6)}
                </td>
                <td className="px-4 py-3 text-slate-200">
                  {formatUsdc(row.amount)}
                  {row.paidAmount > 0n && <span className="text-muted"> · {formatUsdc(row.paidAmount)} paid</span>}
                </td>
                <td className="px-4 py-3 text-slate-300">
                  {row.scoreBps > 0 ? `${(row.scoreBps / 100).toFixed(1)}%` : "—"}
                </td>
                <td className="px-4 py-3 text-slate-300">{MILESTONE_STATUS[row.status] ?? "Unknown"}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">
                  {row.evidenceHash === `0x${"0".repeat(64)}` ? "—" : `${row.evidenceHash.slice(0, 18)}…`}
                </td>
              </tr>
            ))}
            {board.rows.length === 0 && (
              <tr>
                <td className="px-4 py-6 text-sm text-muted" colSpan={7}>
                  No milestones yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
