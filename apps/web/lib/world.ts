import "server-only";

import { signRequest } from "@worldcoin/idkit-server";
import type { IDKitResult, RpContext } from "@worldcoin/idkit-core";
import { keccak256, toHex } from "viem";

/**
 * World ID 4.x verification, server side.
 *
 * Two things have to happen on the server and cannot be done in the browser:
 *
 *  1. Building `rp_context`. IDKit requires an ECDSA signature over
 *     (nonce, created_at, expires_at, action) made with the Relying Party
 *     signing key. That key never reaches the client, so the browser asks
 *     /api/idkit-context for a freshly signed context before opening IDKit.
 *
 *  2. Verifying the returned proof. World's docs are explicit that proofs are
 *     checked by the Developer Portal API, not by the client.
 */

const VERIFY_BASE = process.env.WORLD_VERIFY_BASE_URL ?? "https://developer.world.org";

/** Default lifetime of a signed RP context. Short, because it gates a payout change. */
const RP_CONTEXT_TTL_SECONDS = 300;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See .env.example.`);
  }
  return value;
}

export function worldAppId(): `app_${string}` {
  const appId = requiredEnv("NEXT_PUBLIC_WORLD_APP_ID");
  if (!appId.startsWith("app_")) {
    throw new Error("NEXT_PUBLIC_WORLD_APP_ID must start with 'app_'.");
  }
  return appId as `app_${string}`;
}

export function worldAction(): string {
  return process.env.NEXT_PUBLIC_WORLD_ACTION ?? "grantlane-payout-wallet";
}

export function worldRpId(): string {
  return requiredEnv("WORLD_RP_ID");
}

/**
 * Produces the `rp_context` IDKit needs, signed with the RP key.
 *
 * `action` must match the action the client passes to the preset, because it is
 * hashed into the signed message for non-session proofs.
 */
export function buildRpContext(action: string = worldAction()): RpContext {
  const signingKeyHex = requiredEnv("WORLD_RP_SIGNING_KEY");

  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex,
    action,
    ttl: RP_CONTEXT_TTL_SECONDS,
  });

  return {
    rp_id: worldRpId(),
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
    signature: sig,
  };
}

export type VerifyOutcome =
  | { ok: true; nullifier: string; nullifierHash: `0x${string}`; action?: string; environment?: string }
  | { ok: false; code: string; detail: string };

/**
 * Verifies a complete IDKit result against the Developer Portal.
 *
 * The whole result object is forwarded verbatim: World's API reference says not
 * to remap response identifiers or synthesise a legacy `verification_level`.
 */
export async function verifyIDKitResult(result: IDKitResult): Promise<VerifyOutcome> {
  const url = `${VERIFY_BASE}/api/v4/verify/${worldRpId()}`;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.WORLD_DEV_PORTAL_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(result),
      cache: "no-store",
    });
  } catch (cause) {
    return { ok: false, code: "network_error", detail: `Could not reach ${url}: ${String(cause)}` };
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok || body.success !== true) {
    return {
      ok: false,
      code: typeof body.code === "string" ? body.code : `http_${response.status}`,
      detail: typeof body.detail === "string" ? body.detail : "Verification failed.",
    };
  }

  const nullifier = typeof body.nullifier === "string" ? body.nullifier : undefined;
  if (!nullifier) {
    return { ok: false, code: "missing_nullifier", detail: "Verify succeeded but returned no nullifier." };
  }

  return {
    ok: true,
    nullifier,
    // GrantEscrow stores a bytes32. Hashing normalises the portal's nullifier
    // string to a fixed width and keeps the raw value off-chain.
    nullifierHash: keccak256(toHex(nullifier)),
    action: typeof body.action === "string" ? body.action : undefined,
    environment: typeof body.environment === "string" ? body.environment : undefined,
  };
}

/**
 * Confirms the proof actually carries the Selfie Check credential.
 *
 * `selfieCheckLegacy()` yields World ID 3.0 responses whose `identifier` is the
 * credential name, so a proof from a different credential is rejected here even
 * if it verifies cryptographically.
 */
export function resultCarriesSelfieCredential(result: IDKitResult): boolean {
  const responses = (result as { responses?: Array<{ identifier?: string }> }).responses ?? [];
  return responses.some((r) => r.identifier === "selfie");
}
