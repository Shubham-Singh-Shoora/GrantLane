import { MILESTONE_STATUS } from "./contracts";

/**
 * One place that decides how a milestone status looks.
 *
 * The design uses three roles: olive (accent-2) for settled/good, terracotta
 * (accent) for in-flight or needs-attention, neutral for not-started. Keeping
 * the mapping here means the grant card dots, the timeline nodes, the milestone
 * tags and the review table can never drift apart.
 */

export type MilestoneStatusName = (typeof MILESTONE_STATUS)[number];

export function statusName(status: number): MilestoneStatusName | "Unknown" {
  return MILESTONE_STATUS[status] ?? "Unknown";
}

/** Tag classes from the Organic system. */
export function statusTagClass(status: number): string {
  switch (status) {
    case 4: // Paid
    case 2: // Approved
      return "tag tag-accent-2";
    case 1: // Submitted — in flight
    case 3: // Rejected — needs attention
      return "tag tag-accent";
    default: // Pending
      return "tag tag-neutral";
  }
}

/** Fill colour for the small progress dots on a grant card. */
export function statusDotFill(status: number): string {
  switch (status) {
    case 4:
    case 2:
      return "var(--color-accent-2)";
    case 1:
      return "var(--color-accent)";
    case 3:
      return "var(--color-accent-400)";
    default:
      return "color-mix(in srgb, var(--color-text) 14%, transparent)";
  }
}

/** Numbered node on the milestone timeline. */
export function statusNodeColors(status: number): { bg: string; fg: string } {
  switch (status) {
    case 4:
    case 2:
      return { bg: "var(--color-accent-2)", fg: "var(--color-bg)" };
    case 1:
      return { bg: "var(--color-accent)", fg: "var(--color-bg)" };
    case 3:
      return { bg: "var(--color-accent-400)", fg: "var(--color-bg)" };
    default:
      return {
        bg: "color-mix(in srgb, var(--color-text) 12%, transparent)",
        fg: "color-mix(in srgb, var(--color-text) 70%, transparent)",
      };
  }
}

/** Deterministic two-character badge for an address. */
export function addressInitials(address: string): string {
  return address.replace(/^0x/i, "").slice(0, 2).toUpperCase();
}

export function shortAddress(address: string, lead = 6, tail = 4): string {
  return address.length > lead + tail + 1 ? `${address.slice(0, lead)}…${address.slice(-tail)}` : address;
}
