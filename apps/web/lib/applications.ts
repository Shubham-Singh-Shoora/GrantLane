import "server-only";

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hex } from "viem";

/**
 * Applications and milestone metadata — the off-chain half of a grant.
 *
 * The chain is deliberately thin: GrantEscrow stores milestone *amounts* and
 * nothing else. Everything a human needs to judge a proposal — the pitch, the
 * website, the repo, what each milestone actually has to deliver — lives here,
 * keyed back to the on-chain grant id once the grant is funded.
 *
 * Backed by a JSON file rather than the in-memory map the rest of the app uses,
 * because an application written by the applicant has to still be there when the
 * reviewer opens their own session. That makes this single-instance only: fine
 * for a local demo, wrong for a real deployment, where this is a database.
 */

const DATA_DIR = process.env.GRANTLANE_DATA_DIR ?? join(process.cwd(), ".data");
const DATA_FILE = join(DATA_DIR, "applications.json");

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
};

type Db = { applications: Application[] };

function load(): Db {
  try {
    if (!existsSync(DATA_FILE)) return { applications: [] };
    const parsed = JSON.parse(readFileSync(DATA_FILE, "utf8")) as Db;
    return Array.isArray(parsed.applications) ? parsed : { applications: [] };
  } catch {
    // A corrupt file should not take the app down; start clean rather than throw.
    return { applications: [] };
  }
}

function save(db: Db): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

export function listApplications(): Application[] {
  return load().applications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getApplication(id: string): Application | undefined {
  return load().applications.find((a) => a.id === id);
}

export function getApplicationByGrantId(grantId: string): Application | undefined {
  return load().applications.find((a) => a.grantId === grantId);
}

/** One verified human gets one open application — the anti-bot rule. */
export function findByNullifier(nullifierHash: string): Application | undefined {
  return load().applications.find((a) => a.nullifierHash === nullifierHash);
}

export function createApplication(
  input: Omit<Application, "id" | "createdAt" | "updatedAt" | "status" | "reviewNote" | "approvedMilestones" | "grantId" | "fundingTxHash">,
): Application {
  const db = load();
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

  db.applications.push(application);
  save(db);
  return application;
}

export function updateApplication(id: string, patch: Partial<Application>): Application | undefined {
  const db = load();
  const index = db.applications.findIndex((a) => a.id === id);
  if (index === -1) return undefined;

  const next = { ...db.applications[index], ...patch, id, updatedAt: new Date().toISOString() };
  db.applications[index] = next;
  save(db);
  return next;
}

/** Milestone metadata for a funded grant, so the detail page can show criteria. */
export function milestonesForGrant(grantId: string): ProposedMilestone[] | null {
  const application = getApplicationByGrantId(grantId);
  return application?.approvedMilestones ?? application?.proposedMilestones ?? null;
}
