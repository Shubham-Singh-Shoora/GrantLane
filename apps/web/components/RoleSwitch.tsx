"use client";

import { useRole } from "./RoleProvider";

/**
 * Shows which side you're on. Not a control — the role follows your wallet.
 *
 * Only rendered for granters: an applicant has no second view to be told about,
 * and a badge saying "Applicant" on every page is noise.
 */
export function RoleSwitch() {
  const { isGranter } = useRole();

  if (!isGranter) return null;

  return (
    <span
      className="tag tag-accent-2 whitespace-nowrap"
      title="This wallet is on the granter allowlist, so the review queue is visible to you."
    >
      Granter
    </span>
  );
}
