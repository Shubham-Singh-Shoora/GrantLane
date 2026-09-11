import { MILESTONE_STATUS } from "./contracts";

/**
 * One place that decides how a milestone status looks.
 *
 * The design uses three roles: olive (accent-2) for settled/good, terracotta
 * (accent) for in-flight or needs-attention, neutral for not-started. Keeping
 * the mapping here means the grant card dots, the timeline nodes, the milestone
 * tags and the review table can never drift apart.
 *
 * Status numbers are GrantEscrow.MilestoneStatus: 0 Pending, 1 Claimed (asserted,
 * inside the dispute window), 2 Disputed, 3 Approved, 4 Rejected.
 */

export type MilestoneStatusName = (typeof MILESTONE_STATUS)[number];

export function statusName(status: number): MilestoneStatusName | "Unknown" {
  return MILESTONE_STATUS[status] ?? "Unknown";
}

/** Tag classes from the Organic system. */
export function statusTagClass(status: number): string {
  switch (status) {
    case 3: // Approved
      return "tag tag-accent-2";
    case 1: // Claimed — in the dispute window
    case 2: // Disputed — with UMA
    case 4: // Rejected — needs attention
      return "tag tag-accent";
    default: // Pending
      return "tag tag-neutral";
  }
}

/** Fill colour for the small progress dots on a grant card. */
export function statusDotFill(status: number): string {
  switch (status) {
    case 3:
      return "var(--color-accent-2)";
    case 1:
      return "var(--color-accent)";
    case 2:
    case 4:
      return "var(--color-accent-400)";
    default:
      return "color-mix(in srgb, var(--color-text) 14%, transparent)";
  }
}

/** Numbered node on the milestone timeline. */
export function statusNodeColors(status: number): { bg: string; fg: string } {
  switch (status) {
    case 3:
      return { bg: "var(--color-accent-2)", fg: "var(--color-bg)" };
    case 1:
      return { bg: "var(--color-accent)", fg: "var(--color-bg)" };
    case 2:
    case 4:
      return { bg: "var(--color-accent-400)", fg: "var(--color-bg)" };
    default:
      return {
        bg: "color-mix(in srgb, var(--color-text) 12%, transparent)",
        fg: "color-mix(in srgb, var(--color-text) 70%, transparent)",
      };
  }
}

/** "5 min", "48 h" — for the dispute window. */
export function formatDuration(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600} h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** Deterministic two-character badge for an address. */
export function addressInitials(address: string): string {
  return address.replace(/^0x/i, "").slice(0, 2).toUpperCase();
}

export function shortAddress(address: string, lead = 6, tail = 4): string {
  return address.length > lead + tail + 1 ? `${address.slice(0, lead)}…${address.slice(-tail)}` : address;
}
