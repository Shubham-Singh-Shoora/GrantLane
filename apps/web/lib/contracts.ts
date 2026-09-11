import { createPublicClient, http, type Address, type Hex } from "viem";
import { appChain, RPC_URL } from "./chain";
import { grantEscrowAbi } from "./grantEscrowAbi";

export { grantEscrowAbi };

/** Reverts loudly at import time rather than silently reading address(0). */
function requiredAddress(value: string | undefined, name: string): Address {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${name} is not a valid address. Set it in .env (see .env.example).`);
  }
  return value as Address;
}

export function grantEscrowAddress(): Address {
  return requiredAddress(process.env.NEXT_PUBLIC_GRANT_ESCROW_ADDRESS, "NEXT_PUBLIC_GRANT_ESCROW_ADDRESS");
}

export function usdcAddress(): Address {
  return requiredAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS, "NEXT_PUBLIC_USDC_ADDRESS");
}

/** Optional: the CRE workflow's SettlementReceiver, shown on the admin page when set. */
export function settlementReceiverAddress(): Address | null {
  const value = process.env.NEXT_PUBLIC_SETTLEMENT_RECEIVER_ADDRESS;
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}

/**
 * `cache: "no-store"` keeps Next.js from caching these JSON-RPC calls on the
 * server. Chain state changes under every page; a cached read is a wrong read.
 */
export const publicClient = createPublicClient({
  chain: appChain,
  transport: http(RPC_URL, { fetchOptions: { cache: "no-store" } }),
});

/**
 * Display labels for GrantEscrow.MilestoneStatus, in enum order. "Claimed" is the
 * contract's Asserted: a claim is on UMA and inside its dispute window.
 */
export const MILESTONE_STATUS = ["Pending", "Claimed", "Disputed", "Approved", "Rejected"] as const;
export const STATUS = { Pending: 0, Claimed: 1, Disputed: 2, Approved: 3, Rejected: 4 } as const;

export type Grant = {
  funder: Address;
  grantee: Address;
  payoutWallet: Address;
  totalAmount: bigint;
  releasedAmount: bigint;
  openClaims: number;
  active: boolean;
  termsHash: Hex;
};

export type Milestone = {
  amount: bigint;
  expiresAt: bigint;
  status: number;
  assertionId: Hex;
  evidenceHash: Hex;
};

/** What a milestone card needs to send transactions; strings so it crosses the server/client boundary. */
export type EscrowTerms = {
  escrowAddress: Address;
  usdcAddress: Address;
  /** Claim and dispute bond, USDC base units. */
  bond: string;
  /** Dispute window, seconds. */
  liveness: string;
};

export async function readGrant(grantId: bigint): Promise<Grant> {
  return (await publicClient.readContract({
    address: grantEscrowAddress(),
    abi: grantEscrowAbi,
    functionName: "getGrant",
    args: [grantId],
  })) as Grant;
}

export async function readMilestones(grantId: bigint): Promise<Milestone[]> {
  return (await publicClient.readContract({
    address: grantEscrowAddress(),
    abi: grantEscrowAbi,
    functionName: "getMilestones",
    args: [grantId],
  })) as Milestone[];
}

export async function readGrantCount(): Promise<bigint> {
  return (await publicClient.readContract({
    address: grantEscrowAddress(),
    abi: grantEscrowAbi,
    functionName: "nextGrantId",
  })) as bigint;
}

export async function readEscrowTerms(): Promise<{ bond: bigint; liveness: bigint }> {
  const address = grantEscrowAddress();
  const [bond, liveness] = await Promise.all([
    publicClient.readContract({ address, abi: grantEscrowAbi, functionName: "bond" }),
    publicClient.readContract({ address, abi: grantEscrowAbi, functionName: "liveness" }),
  ]);
  return { bond: bond as bigint, liveness: BigInt(liveness as bigint) };
}

/** Circle USDC has 6 decimals on Base, like everywhere else. */
export function formatUsdc(amount: bigint): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}
