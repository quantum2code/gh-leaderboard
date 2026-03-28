"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

import { trpc } from "@/utils/trpc";

function toDate(value: number | string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value : new Date(value);
}

function formatLastCommit(timestamp: number | string | Date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(toDate(timestamp) ?? new Date(timestamp));
}

function formatSyncTime(timestamp: number | string | Date | null | undefined) {
  if (!timestamp) {
    return "Not synced yet";
  }

  return formatLastCommit(timestamp);
}

export default function LeaderboardPageClient({ slug }: { slug: string }) {
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());
  const repos = useQuery(trpc.listTrackedRepos.queryOptions());
  const leaderboard = useQuery(
    trpc.commitLeaderboard.queryOptions({
      slug,
    }),
  );

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <section className="rounded-3xl border bg-gradient-to-br from-neutral-950 to-neutral-800 p-8 text-white">
        <p className="text-sm uppercase tracking-[0.25em] text-white/65">
          GitHub Commit Leaderboard
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Repo leaderboard
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-white/75">
          Each tracked repository gets its own URL, so leaderboard views can be
          shared directly with routes like <span className="font-mono">/leaderboard/{slug}</span>.
        </p>
      </section>

      <section className="rounded-2xl border p-5">
        <div className="flex flex-wrap items-center gap-2">
          {repos.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading repositories...</p>
          ) : repos.data?.length ? (
            repos.data.map((repo) => {
              const active = repo.slug === slug;

              return (
                <Link
                  key={repo.slug}
                  href={`/leaderboard/${repo.slug}`}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                  }`}
                >
                  {repo.repoOwner}/{repo.repoName}
                </Link>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground">
              No tracked repositories are available yet.
            </p>
          )}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-2xl border p-5">
          <h2 className="text-lg font-medium">API Status</h2>
          <div className="mt-4 flex items-center gap-3">
            <div
              className={`h-2.5 w-2.5 rounded-full ${healthCheck.data ? "bg-green-500" : "bg-red-500"}`}
            />
            <span className="text-sm text-muted-foreground">
              {healthCheck.isLoading
                ? "Checking..."
                : healthCheck.data
                  ? "Connected"
                  : "Disconnected"}
            </span>
          </div>
        </section>

        <section className="rounded-2xl border p-5">
          <h2 className="text-lg font-medium">Tracked Repository</h2>
          {leaderboard.data ? (
            <div className="mt-4 space-y-2 text-sm">
              <p className="font-mono">
                {leaderboard.data.repoName}
              </p>
              <p className="text-muted-foreground">
                {leaderboard.data.totalCommits} commits recorded for this
                leaderboard
              </p>
              <p className="text-muted-foreground capitalize">
                Sync status: {leaderboard.data.syncStatus}
              </p>
              <p className="text-muted-foreground">
                Last synced: {formatSyncTime(leaderboard.data.lastSyncedAt)}
              </p>
              {leaderboard.data.lastSyncError ? (
                <p className="text-red-600">
                  Last error: {leaderboard.data.lastSyncError}
                </p>
              ) : null}
            </div>
          ) : leaderboard.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Loading repository info...
            </p>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              No tracked repository was found for <span className="font-mono">{slug}</span>.
            </p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Top Contributors</h2>
            <p className="text-sm text-muted-foreground">
              Ranked by number of commits captured through the GitHub webhook.
            </p>
          </div>
        </div>

        {leaderboard.isLoading ? (
          <p className="mt-6 text-sm text-muted-foreground">
            Loading leaderboard...
          </p>
        ) : leaderboard.data?.entries.length ? (
          <div className="mt-6 overflow-hidden rounded-2xl border">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 font-medium">Rank</th>
                  <th className="px-4 py-3 font-medium">Contributor</th>
                  <th className="px-4 py-3 font-medium">Commits</th>
                  <th className="px-4 py-3 font-medium">Lines</th>
                  <th className="px-4 py-3 font-medium">Last Commit</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.data.entries.map((entry) => (
                  <tr key={entry.authorKey} className="border-t">
                    <td className="px-4 py-3 font-mono text-muted-foreground">
                      #{entry.rank}
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {entry.displayName}
                    </td>
                    <td className="px-4 py-3">{entry.commitCount}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      +{entry.additions} / -{entry.deletions}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatLastCommit(entry.lastCommitAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : leaderboard.data ? (
          <p className="mt-6 text-sm text-muted-foreground">
            {leaderboard.data.syncStatus === "backfilling" || leaderboard.data.syncStatus === "pending"
              ? "Backfill is still running for this repository."
              : "No commits have been recorded yet for this repository."}
          </p>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            Pick another tracked repository or add one from the admin area.
          </p>
        )}
      </section>
    </main>
  );
}
