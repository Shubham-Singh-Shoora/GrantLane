import { NextResponse } from "next/server";
import { fetchExecutionStatus } from "@/lib/cre";
import { getExecution, latestExecutionFor, updateExecution } from "@/lib/store";
import { readMilestones } from "@/lib/contracts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Polls a scoring run for the UI.
 *
 * Two sources are reconciled: whatever CRE reports about the execution, and the
 * milestone's on-chain state. On-chain wins — once the report has landed and the
 * milestone reads Approved/Paid/Rejected, the run is finished regardless of what
 * the execution record still says.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const executionId = url.searchParams.get("executionId");
  const grantId = url.searchParams.get("grantId");
  const milestoneIdRaw = url.searchParams.get("milestoneId");

  let record =
    executionId != null
      ? await getExecution(executionId)
      : grantId && milestoneIdRaw != null
        ? await latestExecutionFor(grantId, Number(milestoneIdRaw))
        : undefined;

  if (!record) {
    return NextResponse.json({ error: "unknown_execution" }, { status: 404 });
  }

  record = await fetchExecutionStatus(record);

  // Reconcile against the chain.
  let onchain: { status: number; scoreBps: number; paidAmount: string } | null = null;
  try {
    const milestones = await readMilestones(BigInt(record.grantId));
    const milestone = milestones[record.milestoneId];
    if (milestone) {
      onchain = {
        status: Number(milestone.status),
        scoreBps: Number(milestone.scoreBps),
        paidAmount: milestone.paidAmount.toString(),
      };

      // 2 = Approved, 3 = Rejected, 4 = Paid
      if (onchain.status === 2 || onchain.status === 3 || onchain.status === 4) {
        record =
          (await updateExecution(record.executionId, {
            status: "succeeded",
            approved: onchain.status !== 3,
            scoreBps: onchain.scoreBps,
          })) ?? record;
      }
    }
  } catch (cause) {
    // Chain read failure is reported alongside, not fatal to the poll.
    return NextResponse.json(
      { execution: record, onchain: null, warning: String(cause instanceof Error ? cause.message : cause) },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json({ execution: record, onchain }, { headers: { "Cache-Control": "no-store" } });
}
