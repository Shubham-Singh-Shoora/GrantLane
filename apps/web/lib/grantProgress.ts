import "server-only";

import type { Application } from "./applications";
import { grantEscrowAddress, readGrant } from "./contracts";

/**
 * Whether the grant an application was funded as has paid out every milestone.
 *
 * Only a grant on the current escrow counts: grant ids restart at 0 on every
 * deployment, so an application funded on an older escrow would otherwise be
 * judged by whichever unrelated grant now has its id.
 */
export async function isGrantCompleted(application: Application): Promise<boolean> {
  if (application.status !== "funded" || !application.grantId) return false;

  let escrow: string;
  try {
    escrow = grantEscrowAddress();
  } catch {
    return false;
  }
  if (application.escrowAddress?.toLowerCase() !== escrow.toLowerCase()) return false;

  try {
    const grant = await readGrant(BigInt(application.grantId));
    return grant.totalAmount > 0n && grant.releasedAmount >= grant.totalAmount;
  } catch {
    return false;
  }
}

export async function withCompletion<T extends Application>(applications: T[]): Promise<(T & { grantCompleted: boolean })[]> {
  return Promise.all(applications.map(async (a) => ({ ...a, grantCompleted: await isGrantCompleted(a) })));
}
