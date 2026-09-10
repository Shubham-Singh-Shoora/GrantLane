export function SetupNotice({ detail }: { detail: string }) {
  return (
    <div className="animate-rise card elev-sm mt-8" style={{ padding: 26 }}>
      <p className="card-kicker m-0">Not configured yet</p>
      <h3 className="m-0 mt-1">Can&apos;t read GrantEscrow</h3>
      <p className="m-0 mt-2 text-sm" style={{ opacity: 0.8 }}>
        Copy <code className="mono">.env.example</code> to <code className="mono">.env</code> at the repo root, deploy
        the contract, and set <code className="mono">NEXT_PUBLIC_GRANT_ESCROW_ADDRESS</code>.
      </p>
      <pre
        className="mono mt-3 overflow-x-auto rounded-[16px] p-3 text-xs"
        style={{ background: "color-mix(in srgb, var(--color-text) 6%, transparent)", opacity: 0.75 }}
      >
        {detail}
      </pre>
    </div>
  );
}
