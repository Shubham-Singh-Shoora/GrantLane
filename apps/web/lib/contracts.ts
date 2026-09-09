import { createPublicClient, http, type Address } from "viem";
import { arcTestnet, ARC_RPC_URL } from "./chain";
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

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(ARC_RPC_URL),
});

export const MILESTONE_STATUS = ["Pending", "Submitted", "Approved", "Rejected", "Paid"] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUS)[number];

export type Grant = {
  funder: Address;
  grantee: Address;
  payoutWallet: Address;
  token: Address;
  totalAmount: bigint;
  releasedAmount: bigint;
  active: boolean;
};

export type Milestone = {
  amount: bigint;
  paidAmount: bigint;
  status: number;
  scoreBps: number;
  evidenceHash: `0x${string}`;
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

/** USDC has 6 decimals on Arc, both as the native gas token and as the escrow ERC-20. */
export function formatUsdc(amount: bigint): string {
  const negative = amount < 0n;
  const abs = negative ? -amount : amount;
  const whole = abs / 1_000_000n;
  const frac = (abs % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}
