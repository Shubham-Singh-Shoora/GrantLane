"use client";

import { useState } from "react";
import { formatUsdc, type EscrowTerms } from "@/lib/contracts";
import { formatDuration, shortAddress } from "@/lib/status";

export type GrantView = {
  grantId: string;
  funder: string;
  grantee: string;
  payoutWallet: string;
  totalAmount: string;
  releasedAmount: string;
  /** Milestones claimed or disputed right now; the grant can't close while any are. */
  openClaims: number;
  active: boolean;
  termsHash: string;
};

export function EscrowStatus({ grant, terms }: { grant: GrantView; terms: EscrowTerms }) {
  const [techOpen, setTechOpen] = useState(false);

  const total = BigInt(grant.totalAmount);
  const released = BigInt(grant.releasedAmount);
  const remaining = total - released;
  const pct = total === 0n ? 0 : Number((released * 10_000n) / total) / 100;

  return (
    <section className="card elev-sm" style={{ padding: 22, gap: 14 }}>
      <div className="flex items-center gap-2.5">
        <h4 className="m-0">Escrow</h4>
        <span className={`ml-auto ${grant.active ? "tag tag-accent-2" : "tag tag-neutral"}`}>
          {grant.active ? "Active" : "Closed"}
        </span>
      </div>

      <div>
        <div className="track h-2.5">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ background: "var(--color-accent)", width: `${Math.min(pct, 100)}%` }}
          />
        </div>
        <p className="m-0 mt-2.5 text-[13px]" style={{ opacity: 0.7 }}>
          {formatUsdc(released)} of {formatUsdc(total)} released · {pct.toFixed(1)}%
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <div className="min-w-0">
          <p className="kicker m-0">Still escrowed</p>
          <p className="m-0 mt-0.5 font-semibold">{formatUsdc(remaining)} USDC</p>
        </div>
        <div className="min-w-0">
          <p className="kicker m-0">Open claims</p>
          <p className="m-0 mt-0.5 font-semibold">{grant.openClaims}</p>
        </div>
        <div className="min-w-0">
          <p className="kicker m-0">Bond</p>
          <p className="m-0 mt-0.5 font-semibold">{formatUsdc(BigInt(terms.bond))} USDC</p>
        </div>
        <div className="min-w-0">
          <p className="kicker m-0">Dispute window</p>
          <p className="m-0 mt-0.5 font-semibold">{formatDuration(Number(terms.liveness))}</p>
        </div>
      </div>

      <button onClick={() => setTechOpen((v) => !v)} className="btn-ghost self-start" style={{ paddingLeft: 0 }}>
        {techOpen ? "Hide technical detail" : "Technical detail"}
      </button>

      {techOpen && (
        <dl className="animate-rise m-0 flex flex-col gap-2.5">
          {[
            { label: "Grantee", value: grant.grantee },
            { label: "Funder", value: grant.funder },
            { label: "Terms hash", value: grant.termsHash },
            { label: "Escrow", value: terms.escrowAddress },
            { label: "Total (base units)", value: grant.totalAmount },
          ].map((t) => (
            <div key={t.label} className="min-w-0">
              <dt className="kicker">{t.label}</dt>
              <dd className="mono m-0 mt-0.5 break-all text-xs" title={t.value}>
                {t.value.startsWith("0x") && t.value.length === 42 ? shortAddress(t.value, 12, 8) : t.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
