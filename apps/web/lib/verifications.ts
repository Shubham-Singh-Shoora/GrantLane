import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { WorldPurpose } from "./world";

/**
 * Binds "this human was verified" to "this human is submitting", server-side.
 *
 * Without this the gate is theatre: /api/verify-selfie hands the browser a
 * nullifier, and /api/applications would have no way to tell a real one from 32
 * bytes a script made up. So verification does not return a bare nullifier —
 * it returns a *ticket*: the nullifier plus an expiry, HMAC-signed with a server
 * secret. The submitting endpoint verifies that signature before believing any
 * of it.
 *
 * An HMAC rather than a stored session because it needs no shared state between
 * routes and survives a restart, which a Map would not. It is not revocable —
 * the short TTL is what bounds replay — and single-use is enforced separately by
 * the application store rejecting a nullifier it has already seen.
 */

const TICKET_TTL_SECONDS = 15 * 60;

function secret(): string {
  // The attestor key already has to be present and secret for payouts to work,
  // so it doubles as the ticket-signing key rather than adding another required
  // env var. GRANTLANE_TICKET_SECRET overrides it if you'd rather separate them.
  const value = process.env.GRANTLANE_TICKET_SECRET ?? process.env.ATTESTOR_PRIVATE_KEY;
  if (!value) {
    throw new Error("Set GRANTLANE_TICKET_SECRET (or ATTESTOR_PRIVATE_KEY) to sign verification tickets.");
  }
  return value;
}

export type VerificationTicket = string;

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Issued by /api/verify-selfie once World has confirmed the proof. */
export function issueTicket(purpose: WorldPurpose, nullifierHash: string): VerificationTicket {
  const expiresAt = Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS;
  const payload = `${purpose}.${nullifierHash}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export type TicketCheck =
  | { ok: true; nullifierHash: `0x${string}`; purpose: WorldPurpose }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_purpose" };

/** Verified by whichever endpoint the ticket is meant to unlock. */
export function readTicket(ticket: string | undefined, expectedPurpose: WorldPurpose): TicketCheck {
  if (!ticket || typeof ticket !== "string") return { ok: false, reason: "malformed" };

  const parts = ticket.split(".");
  if (parts.length !== 4) return { ok: false, reason: "malformed" };

  const [purpose, nullifierHash, expiresAtRaw, signature] = parts;
  if (!/^0x[0-9a-fA-F]{64}$/.test(nullifierHash) || !/^\d+$/.test(expiresAtRaw)) {
    return { ok: false, reason: "malformed" };
  }

  const expected = sign(`${purpose}.${nullifierHash}.${expiresAtRaw}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }

  if (purpose !== expectedPurpose) return { ok: false, reason: "wrong_purpose" };
  if (Number(expiresAtRaw) < Math.floor(Date.now() / 1000)) return { ok: false, reason: "expired" };

  return { ok: true, nullifierHash: nullifierHash as `0x${string}`, purpose: purpose as WorldPurpose };
}
