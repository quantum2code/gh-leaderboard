"use client";

import { Button } from "@gh-leaderboard/ui/components/button";
import { Checkbox } from "@gh-leaderboard/ui/components/checkbox";
import { Input } from "@gh-leaderboard/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { queryClient, trpc } from "@/utils/trpc";

function formatGitHubStatusMessage(status: string | null) {
  switch (status) {
    case "connected":
      return {
        type: "success" as const,
        message: "GitHub account connected. You can now select public and private repositories.",
      };
    case "missing-config":
      return {
        type: "error" as const,
        message: "GitHub OAuth is not configured yet. Add the GitHub client ID and secret first.",
      };
    case "invalid-state":
      return {
        type: "error" as const,
        message: "GitHub connect session expired or could not be verified. Try again.",
      };
    case "oauth-denied":
      return {
        type: "error" as const,
        message: "GitHub authorization was canceled before the app was connected.",
      };
    case "forbidden":
      return {
        type: "error" as const,
        message: "Admin access is required to connect GitHub.",
      };
    default:
      if (status?.startsWith("oauth-")) {
        return {
          type: "error" as const,
          message: "GitHub OAuth failed before the repository sync could be set up.",
        };
      }

      return null;
  }
}

export default function AdminPanel() {
  const searchParams = useSearchParams();
  const repos = useQuery(trpc.listTrackedRepos.queryOptions());
  const githubConnection = useQuery(trpc.githubAdminConnection.queryOptions());
  const connectedGitHubAccount =
    githubConnection.data &&
    "githubLogin" in githubConnection.data &&
    githubConnection.data.connected
      ? githubConnection.data
      : null;
  const githubRepos = useQuery({
    ...trpc.listGitHubRepositories.queryOptions(),
    enabled: connectedGitHubAccount !== null,
  });
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [repoSearch, setRepoSearch] = useState("");

  useEffect(() => {
    const status = searchParams.get("github");
    const payload = formatGitHubStatusMessage(status);

    if (!payload) {
      return;
    }

    if (payload.type === "success") {
      toast.success(payload.message);
      return;
    }

    toast.error(payload.message);
  }, [searchParams]);

  const connectRepos = useMutation(
    trpc.connectGitHubRepositories.mutationOptions({
      onSuccess(data) {
        queryClient.invalidateQueries();
        setSelectedRepos([]);
        toast.success(
          data.count === 1
            ? `Queued sync for ${data.repositories[0]?.name ?? "repository"}`
            : `Queued sync for ${data.count} repositories`,
        );
      },
    }),
  );

  const visibleGitHubRepos = useMemo(() => {
    const query = repoSearch.trim().toLowerCase();

    return (githubRepos.data?.repositories ?? []).filter((repo) => {
      if (!query) {
        return true;
      }

      return repo.fullName.toLowerCase().includes(query);
    });
  }, [githubRepos.data?.repositories, repoSearch]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <section className="rounded-3xl border bg-gradient-to-br from-stone-950 via-stone-900 to-amber-900 p-8 text-white">
        <p className="text-sm uppercase tracking-[0.25em] text-white/65">
          Admin
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          GitHub repository management
        </h1>
        <p className="mt-4 max-w-3xl text-sm text-white/75">
          GitHub OAuth, private and public repository selection, and webhook setup
          all live here. Repository tracking is only available to admins, and the
          push webhook is enabled automatically after each repo finishes its backfill.
        </p>
      </section>

      <section className="rounded-2xl border p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-medium">GitHub connection</h2>
            <p className="text-sm text-muted-foreground">
              Connect one admin GitHub account with access to the repositories you
              want to track.
            </p>
          </div>
          <Button
            onClick={() => {
              window.location.href = "/api/admin/github/connect";
            }}
            type="button"
          >
            {connectedGitHubAccount ? "Reconnect GitHub" : "Connect GitHub"}
          </Button>
        </div>

        {connectedGitHubAccount ? (
          <div className="mt-4 grid gap-2 rounded-xl border bg-muted/20 p-4 text-sm">
            <p>
              Connected as{" "}
              <span className="font-medium">
                {connectedGitHubAccount.githubLogin ?? "GitHub user"}
              </span>
            </p>
            <p className="text-muted-foreground">
              Linked by {connectedGitHubAccount.connectedByEmail}
            </p>
            {connectedGitHubAccount.scope ? (
              <p className="text-muted-foreground">
                Scopes: {connectedGitHubAccount.scope}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No GitHub admin connection is configured yet.
          </p>
        )}
      </section>

      <section className="rounded-2xl border p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-medium">Select repositories</h2>
            <p className="text-sm text-muted-foreground">
              Choose public or private repositories from the connected GitHub account.
            </p>
          </div>
          <label className="grid gap-2 text-sm md:w-80">
            <span>Search repositories</span>
            <Input
              placeholder="owner/repo"
              value={repoSearch}
              onChange={(event) => setRepoSearch(event.target.value)}
            />
          </label>
        </div>

        {!connectedGitHubAccount ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Connect GitHub first to load repository choices.
          </p>
        ) : githubRepos.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Loading repositories from GitHub...
          </p>
        ) : visibleGitHubRepos.length ? (
          <>
            <div className="mt-4 max-h-[28rem] overflow-auto rounded-2xl border">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 font-medium">Select</th>
                    <th className="px-4 py-3 font-medium">Repository</th>
                    <th className="px-4 py-3 font-medium">Visibility</th>
                    <th className="px-4 py-3 font-medium">Access</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleGitHubRepos.map((repo) => {
                    const checked = selectedRepos.includes(repo.fullName);
                    const disabled = !repo.canAdminister;

                    return (
                      <tr key={repo.id} className="border-t align-top">
                        <td className="px-4 py-3">
                          <Checkbox
                            checked={checked}
                            disabled={disabled}
                            onCheckedChange={(value) => {
                              setSelectedRepos((current) => {
                                if (!value) {
                                  return current.filter((item) => item !== repo.fullName);
                                }

                                if (current.includes(repo.fullName)) {
                                  return current;
                                }

                                return [...current, repo.fullName];
                              });
                            }}
                          />
                        </td>
                        <td className="px-4 py-3 font-mono">{repo.fullName}</td>
                        <td className="px-4 py-3">
                          {repo.isPrivate ? "Private" : "Public"}
                        </td>
                        <td className="px-4 py-3">
                          {repo.canAdminister ? (
                            "Admin access"
                          ) : (
                            <span className="text-muted-foreground">
                              Missing admin permission for webhook setup
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <p className="text-sm text-muted-foreground">
                {selectedRepos.length} repositories selected
              </p>
              <Button
                disabled={!selectedRepos.length || connectRepos.isPending}
                onClick={() => {
                  connectRepos.mutate({
                    repositories: selectedRepos,
                  });
                }}
                type="button"
              >
                {connectRepos.isPending ? "Queueing repositories..." : "Track selected repositories"}
              </Button>
            </div>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No repositories matched this search.
          </p>
        )}
      </section>

      <section className="rounded-2xl border p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Tracked repositories</h2>
            <p className="text-sm text-muted-foreground">
              Each repository maps to its own shareable leaderboard URL.
            </p>
          </div>
        </div>

        {repos.isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Loading repositories...
          </p>
        ) : repos.data?.length ? (
          <div className="mt-4 overflow-hidden rounded-2xl border">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 font-medium">Slug</th>
                  <th className="px-4 py-3 font-medium">Repository</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Leaderboard</th>
                </tr>
              </thead>
              <tbody>
                {repos.data.map((repo) => (
                  <tr key={repo.slug} className="border-t">
                    <td className="px-4 py-3 font-mono">{repo.slug}</td>
                    <td className="px-4 py-3">
                      {repo.repoOwner}/{repo.repoName}
                    </td>
                    <td className="px-4 py-3">
                      <div className="space-y-1">
                        <p className="capitalize">{repo.syncStatus}</p>
                        <p className="text-xs text-muted-foreground">
                          {repo.webhookEnabledAt
                            ? "Webhook enabled"
                            : repo.backfillCompletedAt
                              ? "Webhook not enabled yet"
                              : "Backfill pending"}
                        </p>
                        {repo.lastSyncError ? (
                          <p className="text-xs text-red-600">{repo.lastSyncError}</p>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        className="underline"
                        href={`/leaderboard/${repo.slug}`}
                      >
                        Open leaderboard
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            No repositories have been registered yet.
          </p>
        )}
      </section>
    </main>
  );
}
