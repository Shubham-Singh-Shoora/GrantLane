/**
 * Who is allowed to act as a granter.
 *
 * An allowlist of wallet addresses, read from NEXT_PUBLIC_GRANTER_ADDRESSES
 * (comma-separated). Connect one of them and the reviewer UI appears; connect
 * anything else and you only ever see the applicant side.
 *
 * WHAT THIS DOES AND DOES NOT BUY YOU. The money is already safe without it:
 * escrowing a grant spends the funder's own USDC, releasing one needs a
 * DON-signed report through the forwarder, and submitting evidence is
 * restricted to the grantee — all enforced by the contract, not by this file.
 * What the allowlist protects is the off-chain review surface: reading the
 * application queue and approving scope.
 *
 * It is a client-side gate. `NEXT_PUBLIC_` means the list is public (it is just
 * addresses, which are public anyway), and a determined caller can still reach
 * /api/applications directly, because the server has no way to authenticate a
 * wallet without a signature. Closing that properly means sign-in-with-Ethereum:
 * the client signs a nonce, the server recovers the address and checks it
 * against this same list. Until then, treat this as UI segregation rather than
 * authorisation.
 */

/** Falls back to the deployer, which is the funder in the seeded demo. */
const DEFAULT_GRANTERS = ["0x30411b981578Fad62D4D20316Da8936cE61F8509"];

export function granterAddresses(): string[] {
  const configured = process.env.NEXT_PUBLIC_GRANTER_ADDRESSES;
  const list = configured
    ? configured
        .split(",")
        .map((a) => a.trim())
        .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
    : DEFAULT_GRANTERS;

  return list.map((a) => a.toLowerCase());
}

export function isGranterAddress(address: string | undefined): boolean {
  if (!address) return false;
  return granterAddresses().includes(address.toLowerCase());
}
