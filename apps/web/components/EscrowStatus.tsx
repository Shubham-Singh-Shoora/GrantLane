import { formatUsdc } from "@/lib/contracts";

export type GrantView = {
  grantId: string;
  funder: string;
  grantee: string;
  payoutWallet: string;
  token: string;
  totalAmount: string;
  releasedAmount: string;
  active: boolean;
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="text-sm text-slate-100">{value}</dd>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function EscrowStatus({ grant }: { grant: GrantView }) {
  const total = BigInt(grant.totalAmount);
  const released = BigInt(grant.releasedAmount);
  const remaining = total - released;
  const pct = total === 0n ? 0 : Number((released * 10_000n) / total) / 100;

  return (
    <section className="panel p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100">Escrow</h2>
        <span
          className={
            grant.active
              ? "chip bg-accent/10 text-accent ring-accent/40"
              : "chip bg-white/5 text-muted ring-edge"
          }
        >
          {grant.active ? "Active" : "Closed"}
        </span>
      </div>

      <div className="mb-4">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {formatUsdc(released)} of {formatUsdc(total)} USDC released ({pct.toFixed(1)}%)
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-4">
        <Stat label="Still escrowed" value={`${formatUsdc(remaining)} USDC`} />
        <Stat label="Grantee" value={grant.grantee} />
        <Stat
          label="Payout wallet"
          value={grant.payoutWallet}
          hint={
            grant.payoutWallet.toLowerCase() === grant.grantee.toLowerCase()
              ? "Default — same as grantee"
              : "Changed via a verified Selfie Check"
          }
        />
        <Stat label="Funder" value={grant.funder} />
      </dl>
    </section>
  );
}
