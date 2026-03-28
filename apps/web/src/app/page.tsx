"use client";

import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

function formatLastCommit(timestamp: number) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export default function Home() {
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());
  const leaderboard = useQuery(trpc.commitLeaderboard.queryOptions());

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <section className="rounded-3xl border bg-gradient-to-br from-neutral-950 to-neutral-800 p-8 text-white">
        <p className="text-sm uppercase tracking-[0.25em] text-white/65">GitHub Commit Leaderboard</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Track commits for one repository in real time.
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-white/75">
          Incoming GitHub push webhooks are filtered to the configured owner and repo, then grouped
          into a leaderboard by contributor.
        </p>
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
                {leaderboard.data.repoOwner}/{leaderboard.data.repoName}
              </p>
              <p className="text-muted-foreground">
                {leaderboard.data.totalCommits} commits recorded for this leaderboard
              </p>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              {leaderboard.isLoading ? "Loading repository info..." : "No repository data yet."}
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
          <p className="mt-6 text-sm text-muted-foreground">Loading leaderboard...</p>
        ) : leaderboard.data?.entries.length ? (
          <div className="mt-6 overflow-hidden rounded-2xl border">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 font-medium">Rank</th>
                  <th className="px-4 py-3 font-medium">Contributor</th>
                  <th className="px-4 py-3 font-medium">Commits</th>
                  <th className="px-4 py-3 font-medium">Last Commit</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.data.entries.map((entry) => (
                  <tr key={entry.authorKey} className="border-t">
                    <td className="px-4 py-3 font-mono text-muted-foreground">#{entry.rank}</td>
                    <td className="px-4 py-3 font-medium">{entry.displayName}</td>
                    <td className="px-4 py-3">{entry.commitCount}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatLastCommit(entry.lastCommitAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">
            No commits have been recorded yet. Send a push webhook for the configured repository to
            populate the leaderboard.
          </p>
        )}
      </section>
    </main>
  );
}
