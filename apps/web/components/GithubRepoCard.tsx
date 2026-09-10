"use client";

import type { RepoSnapshot } from "@/lib/applications";

function relativeDays(iso: string | null): string {
  if (!iso) return "unknown";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "a month ago" : `${months} months ago`;
}

/** What the reviewer sees instead of taking "we built it" on trust. */
export function GithubRepoCard({ repo, compact = false }: { repo: RepoSnapshot; compact?: boolean }) {
  const stats = [
    { label: "Stars", value: repo.stars.toLocaleString("en-US") },
    { label: "Forks", value: repo.forks.toLocaleString("en-US") },
    { label: "Open issues", value: repo.openIssues.toLocaleString("en-US") },
    { label: "Last push", value: relativeDays(repo.pushedAt) },
  ];

  return (
    <div
      className="rounded-[20px] p-4"
      style={{ background: "color-mix(in srgb, var(--color-text) 5%, transparent)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden>◈</span>
        <a href={repo.htmlUrl} target="_blank" rel="noreferrer noopener" className="mono text-[13px] font-semibold">
          {repo.fullName}
        </a>
        {repo.language && <span className="tag tag-neutral">{repo.language}</span>}
      </div>

      {repo.description && (
        <p className="m-0 mt-2 text-[13px]" style={{ opacity: 0.75 }}>
          {repo.description}
        </p>
      )}

      {!compact && (
        <dl className="m-0 mt-3 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))" }}>
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="kicker">{s.label}</dt>
              <dd className="m-0 mt-0.5 text-sm font-semibold">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <p className="m-0 mt-2.5 text-[11px]" style={{ opacity: 0.5 }}>
        Snapshot taken {new Date(repo.fetchedAt).toLocaleString()} — repo stats drift after submission.
      </p>
    </div>
  );
}
