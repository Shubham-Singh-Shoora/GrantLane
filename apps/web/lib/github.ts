import "server-only";

import type { RepoSnapshot } from "./applications";

/**
 * Reads public repository metadata so an application can show real work rather
 * than a claim about it.
 *
 * Unauthenticated, which is deliberate: it only ever touches public repos, and
 * asking a grant applicant to install a GitHub App to submit a proposal is a
 * worse trade than living with the 60-requests/hour anonymous rate limit. Set
 * GITHUB_TOKEN to raise it.
 */

const REPO_URL = /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/;

export function parseRepoUrl(url: string): { owner: string; repo: string } | null {
  const match = REPO_URL.exec(url.trim());
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

export type RepoLookup =
  | { ok: true; snapshot: RepoSnapshot }
  | { ok: false; code: "invalid_url" | "not_found" | "rate_limited" | "unavailable"; detail: string };

export async function fetchRepoSnapshot(url: string): Promise<RepoLookup> {
  const parsed = parseRepoUrl(url);
  if (!parsed) {
    return { ok: false, code: "invalid_url", detail: "Expected a URL like https://github.com/owner/repo." };
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, {
      headers,
      cache: "no-store",
    });
  } catch (cause) {
    return { ok: false, code: "unavailable", detail: `Could not reach GitHub: ${String(cause)}` };
  }

  if (response.status === 404) {
    return { ok: false, code: "not_found", detail: `No public repo at ${parsed.owner}/${parsed.repo}.` };
  }
  if (response.status === 403 || response.status === 429) {
    return {
      ok: false,
      code: "rate_limited",
      detail: "GitHub rate-limited this lookup. Set GITHUB_TOKEN to raise the limit, or try again shortly.",
    };
  }
  if (!response.ok) {
    return { ok: false, code: "unavailable", detail: `GitHub returned ${response.status}.` };
  }

  const data = (await response.json()) as Record<string, unknown>;

  return {
    ok: true,
    snapshot: {
      fullName: typeof data.full_name === "string" ? data.full_name : `${parsed.owner}/${parsed.repo}`,
      description: typeof data.description === "string" ? data.description : null,
      stars: typeof data.stargazers_count === "number" ? data.stargazers_count : 0,
      forks: typeof data.forks_count === "number" ? data.forks_count : 0,
      openIssues: typeof data.open_issues_count === "number" ? data.open_issues_count : 0,
      language: typeof data.language === "string" ? data.language : null,
      pushedAt: typeof data.pushed_at === "string" ? data.pushed_at : null,
      htmlUrl: typeof data.html_url === "string" ? data.html_url : `https://github.com/${parsed.owner}/${parsed.repo}`,
      fetchedAt: new Date().toISOString(),
    },
  };
}
