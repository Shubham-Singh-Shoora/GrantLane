"use client";

import type { Address, Hex } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { CHAIN_ID } from "@/lib/chain";
import { disputeRegistryAbi } from "@/lib/contracts";
import { shortAddress } from "@/lib/status";
import { UMA_OOV3_ADDRESS, umaAssertionAbi } from "@/lib/uma";

/**
 * Every dispute ever filed against a milestone, read from DisputeRegistry on-chain,
 * with each one's outcome read from UMA. A dispute that lost stays listed — the
 * reason someone gave is part of the milestone's record either way.
 */
export function DisputeHistory({
  registry,
  grantId,
  milestoneId,
  currentAssertionId,
  live,
}: {
  registry: Address;
  grantId: string;
  milestoneId: number;
  currentAssertionId: Hex;
  /** Re-read while a claim is open or disputed, when a new dispute or outcome can appear. */
  live: boolean;
}) {
  const { data: disputes } = useReadContract({
    address: registry,
    abi: disputeRegistryAbi,
    functionName: "disputesFor",
    args: [BigInt(grantId), BigInt(milestoneId)],
    chainId: CHAIN_ID,
    query: { refetchInterval: live ? 8_000 : false },
  });
  const list = disputes ?? [];

  const { data: assertions } = useReadContracts({
    contracts: list.map((d) => ({
      address: UMA_OOV3_ADDRESS,
      abi: umaAssertionAbi,
      functionName: "getAssertion" as const,
      args: [d.assertionId] as const,
      chainId: CHAIN_ID,
    })),
    query: { enabled: list.length > 0, refetchInterval: live ? 8_000 : false },
  });

  if (list.length === 0) return null;

  const rows = list
    .map((d, i) => {
      const result = assertions?.[i]?.status === "success" ? assertions[i].result : undefined;
      const outcome = !result
        ? null
        : !result.settled
          ? { label: "Awaiting outcome", tag: "tag tag-neutral" }
          : result.settlementResolution
            ? { label: "Grantee was right", tag: "tag tag-accent-2" }
            : { label: "Disputer was right", tag: "tag tag-accent" };
      return { d, outcome };
    })
    .reverse();

  return (
    <div className="flex flex-col gap-2">
      <p className="kicker m-0">{list.length === 1 ? "Dispute" : `Disputes · ${list.length}`}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map(({ d, outcome }) => {
          const current = d.assertionId.toLowerCase() === currentAssertionId.toLowerCase();
          return (
            <li
              key={`${d.assertionId}-${d.reasonHash}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[16px] px-3.5 py-2.5"
              style={{ background: "color-mix(in srgb, var(--color-text) 4%, transparent)" }}
            >
              {outcome && <span className={outcome.tag}>{outcome.label}</span>}
              {current && <span className="tag tag-neutral">This claim</span>}
              <span className="text-[12.5px]" style={{ opacity: 0.75 }} suppressHydrationWarning>
                by <span className="mono">{shortAddress(d.disputer)}</span> ·{" "}
                {new Date(Number(d.filedAt) * 1000).toLocaleString()}
              </span>
              <a
                href={`/dispute/${d.reasonHash}`}
                target="_blank"
                rel="noreferrer"
                className="btn-ghost ml-auto"
                style={{ paddingLeft: 0 }}
              >
                Read why ↗
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
