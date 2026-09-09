import "server-only";

import { privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { ARC_CHAIN_ID } from "./chain";
import { grantEscrowAbi, grantEscrowAddress, publicClient } from "./contracts";

/**
 * The attestor key is the bridge between "World says this human is real" and
 * "GrantEscrow will move the payout wallet". The server verifies a Selfie Check
 * proof, then signs this struct; the grantee submits the signature on-chain.
 *
 * Deliberately EIP-712 rather than a bare on-chain allowlist write: it keeps the
 * server out of the transaction path (the grantee pays gas) while still making
 * the payout change unforgeable without the server's key.
 */

const PAYOUT_WALLET_TYPES = {
  PayoutWalletChange: [
    { name: "grantId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "nullifierHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Must match the deadline window the UI advertises to the user. */
export const ATTESTATION_TTL_SECONDS = 15 * 60;

function attestorAccount() {
  const key = process.env.ATTESTOR_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error("ATTESTOR_PRIVATE_KEY must be a 32-byte hex private key. See .env.example.");
  }
  return privateKeyToAccount(key as Hex);
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

  const deadline = BigInt(Math.floor(Date.now() / 1000) + ATTESTATION_TTL_SECONDS);

  const signature = await account.signTypedData({
    domain: {
      name: "GrantLane",
      version: "1",
      chainId: ARC_CHAIN_ID,
      verifyingContract,
    },
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
