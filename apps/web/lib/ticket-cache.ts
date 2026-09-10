/**
 * Keeps a verification ticket alive across reloads and retries.
 *
 * Without this, the ticket lives in component state, so anything that remounts
 * the page throws it away — and the user is asked to redo a face scan because a
 * downstream service returned an error. That is the wrong thing to charge
 * someone for. The ticket is valid for fifteen minutes and is scoped to one
 * purpose; reusing it inside that window is exactly what it is for.
 *
 * sessionStorage rather than localStorage: proof of humanity should not outlive
 * the browsing session. The server re-checks the signature and expiry on every
 * use regardless, so a stale or tampered entry here buys nothing — the worst
 * case is the user is asked to verify again.
 */

const PREFIX = "grantlane-ticket:";

/** Tickets are `purpose.nullifier.expiresAt.signature`. */
function expiryOf(ticket: string): number | null {
  const parts = ticket.split(".");
  if (parts.length !== 4) return null;
  const expiresAt = Number(parts[2]);
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

/** A few seconds of headroom so we never hand back one about to be refused. */
const SKEW_SECONDS = 20;

export function saveTicket(key: string, ticket: string): void {
  try {
    sessionStorage.setItem(PREFIX + key, ticket);
  } catch {
    // Private mode or blocked storage — the ticket just won't survive a reload.
  }
}

export function loadTicket(key: string): string | null {
  try {
    const ticket = sessionStorage.getItem(PREFIX + key);
    if (!ticket) return null;

    const expiresAt = expiryOf(ticket);
    if (expiresAt === null || expiresAt - SKEW_SECONDS < Math.floor(Date.now() / 1000)) {
      sessionStorage.removeItem(PREFIX + key);
      return null;
    }
    return ticket;
  } catch {
    return null;
  }
}

export function clearTicket(key: string): void {
  try {
    sessionStorage.removeItem(PREFIX + key);
  } catch {
    // nothing to do
  }
}

/** Seconds left on a cached ticket, for telling the user how long they have. */
export function ticketSecondsLeft(ticket: string): number {
  const expiresAt = expiryOf(ticket);
  if (expiresAt === null) return 0;
  return Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
}
