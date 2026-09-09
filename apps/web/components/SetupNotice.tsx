export function SetupNotice({ detail }: { detail: string }) {
  return (
    <div className="panel p-6">
      <h2 className="text-sm font-semibold text-warn">Not configured yet</h2>
      <p className="mt-2 text-sm text-slate-300">
        The app could not read GrantEscrow on Arc Testnet. Copy <code className="text-slate-100">.env.example</code> to{" "}
        <code className="text-slate-100">.env</code>, deploy the contract, and set{" "}
        <code className="text-slate-100">NEXT_PUBLIC_GRANT_ESCROW_ADDRESS</code>.
      </p>
      <pre className="mt-3 overflow-x-auto rounded-md bg-ink p-3 text-xs text-muted">{detail}</pre>
    </div>
  );
}
