import type { Address } from "viem";

/**
 * The EIP-712 shapes the attestor signs and GrantEscrow verifies.
 *
 * Field names and order must match the typehash strings in GrantEscrow.sol exactly:
 *   PayoutWalletChange(uint256 grantId,address newWallet,bytes32 nullifierHash,uint256 nonce,uint256 deadline)
 *   MilestoneClaim(uint256 grantId,uint256 milestoneId,bytes32 evidenceHash,bytes32 nullifierHash,uint256 nonce,uint256 deadline)
 * A mismatch doesn't fail loudly here — every signature just recovers to the wrong
 * address on-chain. Kept free of runtime imports so it can be checked in isolation.
 */

export function grantLaneDomain(chainId: number, verifyingContract: Address) {
  return { name: "GrantLane", version: "1", chainId, verifyingContract } as const;
}

export const PAYOUT_WALLET_TYPES = {
  PayoutWalletChange: [
    { name: "grantId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "nullifierHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const MILESTONE_CLAIM_TYPES = {
  MilestoneClaim: [
    { name: "grantId", type: "uint256" },
    { name: "milestoneId", type: "uint256" },
    { name: "evidenceHash", type: "bytes32" },
    { name: "nullifierHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
