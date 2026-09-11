import "server-only";

import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { CHAIN_ID } from "./chain";
import { grantEscrowAbi, grantEscrowAddress, publicClient } from "./contracts";
import { grantLaneDomain, MILESTONE_CLAIM_TYPES, PAYOUT_WALLET_TYPES } from "./eip712";

/**
 * The attestor key is the bridge between "World says this human is real" and
 * "GrantEscrow will act". The server verifies a Selfie Check proof, then signs an
 * EIP-712 struct; the grantee submits the signature on-chain themselves.
 *
 * Deliberately EIP-712 rather than a bare on-chain allowlist write: it keeps the
 * server out of the transaction path (the grantee pays gas) while still making
 * the gated action unforgeable without the server's key. Two actions are gated
 * this way: claiming a milestone, and changing the payout wallet.
 */

/** Must match the deadline window the UI advertises to the user. */
export const ATTESTATION_TTL_SECONDS = 15 * 60;

function attestorAccount() {
  const key = process.env.ATTESTOR_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("ATTESTOR_PRIVATE_KEY must be a 32-byte hex private key. See .env.example.");
  }
  return privateKeyToAccount(key as Hex);
}

function deadlineFromNow(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + ATTESTATION_TTL_SECONDS);
}

export type PayoutAttestation = {
  grantId: string;
  newWallet: Address;
  nullifierHash: Hex;
  nonce: string;
  deadline: string;
  signature: Hex;
  attestor: Address;
};

/**
 * Reads the grant's current nonce and signs a payout-wallet change for it.
 *
 * The nonce comes from the contract rather than from the caller so a client
 * cannot replay an older signature by supplying a stale nonce.
 */
export async function signPayoutWalletChange(params: {
  grantId: bigint;
  newWallet: Address;
  nullifierHash: Hex;
}): Promise<PayoutAttestation> {
  const account = attestorAccount();
  const verifyingContract = grantEscrowAddress();

  const nonce = (await publicClient.readContract({
    address: verifyingContract,
    abi: grantEscrowAbi,
    functionName: "payoutWalletNonce",
    args: [params.grantId],
  })) as bigint;

  const deadline = deadlineFromNow();

  const signature = await account.signTypedData({
    domain: grantLaneDomain(CHAIN_ID, verifyingContract),
    types: PAYOUT_WALLET_TYPES,
    primaryType: "PayoutWalletChange",
    message: {
      grantId: params.grantId,
      newWallet: params.newWallet,
      nullifierHash: params.nullifierHash,
      nonce,
      deadline,
    },
  });

  return {
    grantId: params.grantId.toString(),
    newWallet: params.newWallet,
    nullifierHash: params.nullifierHash,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature,
    attestor: account.address,
  };
}

export type ClaimAttestation = {
  grantId: string;
  milestoneId: number;
  evidenceHash: Hex;
  nullifierHash: Hex;
  nonce: string;
  deadline: string;
  signature: Hex;
  attestor: Address;
};

/**
 * Signs a milestone claim, bound to the exact evidence hash and the grant's current
 * claim nonce.
 *
 * World ID nullifiers are stable per person per action, so the contract can't make
 * them single-use without blocking a grantee's second milestone; the nonce is what
 * prevents replay. It also means that if another claim on the same grant lands
 * between signing and submitting, this attestation goes stale and the grantee
 * simply prepares the claim again.
 */
export async function signMilestoneClaim(params: {
  grantId: bigint;
  milestoneId: number;
  evidenceHash: Hex;
  nullifierHash: Hex;
}): Promise<ClaimAttestation> {
  const account = attestorAccount();
  const verifyingContract = grantEscrowAddress();

  const nonce = (await publicClient.readContract({
    address: verifyingContract,
    abi: grantEscrowAbi,
    functionName: "claimNonce",
    args: [params.grantId],
  })) as bigint;

  const deadline = deadlineFromNow();

  const signature = await account.signTypedData({
    domain: grantLaneDomain(CHAIN_ID, verifyingContract),
    types: MILESTONE_CLAIM_TYPES,
    primaryType: "MilestoneClaim",
    message: {
      grantId: params.grantId,
      milestoneId: BigInt(params.milestoneId),
      evidenceHash: params.evidenceHash,
      nullifierHash: params.nullifierHash,
      nonce,
      deadline,
    },
  });

  return {
    grantId: params.grantId.toString(),
    milestoneId: params.milestoneId,
    evidenceHash: params.evidenceHash,
    nullifierHash: params.nullifierHash,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
    signature,
    attestor: account.address,
  };
}
