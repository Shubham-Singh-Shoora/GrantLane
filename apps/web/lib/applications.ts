import "server-only";

import { randomUUID } from "node:crypto";
import type { Hex } from "viem";
import { kvGet, kvSet } from "./kv";

/**
 * Applications and milestone metadata — the off-chain half of a grant.
 *
 * The chain is deliberately thin: GrantEscrow stores milestone *amounts* and
 * nothing else. Everything a human needs to judge a proposal — the pitch, the
 * website, the repo, what each milestone actually has to deliver — lives here,
 * keyed back to the on-chain grant id once the grant is funded.
 *
 * Persistence goes through lib/kv, which is a JSON file locally and Redis in a
 * serverless deployment. Every function here is async for that reason, even the
 * reads that look like they could be synchronous.
 *
 * The whole collection is one key. That is fine at grant-round scale — tens to
 * low hundreds of applications — and keeps writes atomic without a transaction.
 * It would be the wrong shape at ten thousand.
 */

const KEY = "grantlane:applications";

export type ApplicationStatus = "submitted" | "approved" | "declined" | "funded";

export type ProposedMilestone = {
  title: string;
  criteria: string;
  /** USDC base units (6 decimals). */
  amount: string;
};

export type RepoSnapshot = {
  fullName: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  pushedAt: string | null;
  htmlUrl: string;
  /** When the snapshot was taken — repo stats drift. */
  fetchedAt: string;
};

export type Application = {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: ApplicationStatus;

  // — what the applicant submitted —
  projectName: string;
  organisation: string;
  pitch: string;
  website: string | null;
  repoUrl: string | null;
  repo: RepoSnapshot | null;
  /** Wallet the applicant wants paid. */
  wallet: string;
  /** Total requested, USDC base units. */
  requestedAmount: string;
  proposedMilestones: ProposedMilestone[];

  // — proof of humanity, captured at submit —
  humanVerified: boolean;
  nullifierHash: Hex | null;
  verifiedAt: string | null;

  // — reviewer's decision —
  reviewNote: string | null;
  /** Milestones the reviewer actually funds; may differ from what was proposed. */
  approvedMilestones: ProposedMilestone[] | null;
  /** Set once createGrant lands on-chain. */
  grantId: string | null;
  fundingTxHash: string | null;
  /** keccak256 of the funded milestone terms, as committed by createGrant. */
  termsHash?: Hex | null;
  /**
   * The escrow the grant id belongs to. Grant ids restart at 0 on every deployment,
   * so an id alone would attach an old grant's milestones to a new one.
   */
  escrowAddress?: string | null;
};

async function load(): Promise<Application[]> {
  const raw = await kvGet(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Application[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function save(applications: Application[]): Promise<void> {
  await kvSet(KEY, JSON.stringify(applications));
}

export async function listApplications(): Promise<Application[]> {
  const applications = await load();
  return applications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getApplication(id: string): Promise<Application | undefined> {
  return (await load()).find((a) => a.id === id);
}

export async function getApplicationByGrantId(grantId: string): Promise<Application | undefined> {
  return (await load()).find((a) => a.grantId === grantId);
}

/**
 * The anti-bot rule: one verified human gets one *open* application — one still
 * awaiting a decision or awaiting funding. Once it's declined or funded, the same
 * person can apply again (a new round, a new project). Without that, a World ID
 * nullifier being stable per person would mean one application per person, ever.
 */
export async function findOpenByNullifier(nullifierHash: string): Promise<Application | undefined> {
  return (await load()).find(
    (a) => a.nullifierHash === nullifierHash && (a.status === "submitted" || a.status === "approved"),
  );
}

export async function createApplication(
  input: Omit<
    Application,
    "id" | "createdAt" | "updatedAt" | "status" | "reviewNote" | "approvedMilestones" | "grantId" | "fundingTxHash"
  >,
): Promise<Application> {
  const applications = await load();
  const now = new Date().toISOString();

  const application: Application = {
    ...input,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "submitted",
    reviewNote: null,
    approvedMilestones: null,
    grantId: null,
    fundingTxHash: null,
  };

  applications.push(application);
  await save(applications);
  return application;
}

export async function updateApplication(id: string, patch: Partial<Application>): Promise<Application | undefined> {
  const applications = await load();
  const index = applications.findIndex((a) => a.id === id);
  if (index === -1) return undefined;

  const next = { ...applications[index], ...patch, id, updatedAt: new Date().toISOString() };
  applications[index] = next;
  await save(applications);
  return next;
}

/**
 * The funded milestone terms for a grant on a given escrow — what its termsHash
 * commits to, and what a disputed claim is judged against.
 */
export async function milestonesForGrant(grantId: string, escrowAddress: string): Promise<ProposedMilestone[] | null> {
  const application = (await load()).find(
    (a) => a.grantId === grantId && a.escrowAddress?.toLowerCase() === escrowAddress.toLowerCase(),
  );
  return application?.approvedMilestones ?? null;
}
