"use client";

import { Button } from "@gh-leaderboard/ui/components/button";
import { Input } from "@gh-leaderboard/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { queryClient, trpc } from "@/utils/trpc";

export default function AdminPanel() {
  const router = useRouter();
  const repos = useQuery(trpc.listTrackedRepos.queryOptions());
  const [repoOwner, setRepoOwner] = useState("");
  const [repoName, setRepoName] = useState("");
  const [slug, setSlug] = useState("");

  const createRepo = useMutation(
    trpc.connectTrackedRepo.mutationOptions({
      onSuccess(data) {
        queryClient.invalidateQueries();
        toast.success(
          data.queuedBackfill
            ? `Queued backfill for ${data.repoOwner}/${data.repoName}`
            : `Tracking ${data.repoOwner}/${data.repoName}`,
        );
        setRepoOwner("");
        setRepoName("");
        setSlug("");
        router.push(`/leaderboard/${data.slug}`);
      },
    }),
  );

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <section className="rounded-3xl border bg-gradient-to-br from-stone-950 via-stone-900 to-amber-900 p-8 text-white">
        <p className="text-sm uppercase tracking-[0.25em] text-white/65">
          Admin
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          Manage tracked repositories
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-white/75">
          Connect a public repository here. We will register it, backfill the
          latest commits, and then keep the leaderboard in sync from incoming
          GitHub push webhooks you already have configured.
        </p>
      </section>

      <section className="rounded-2xl border p-5">
        <h2 className="text-lg font-medium">Add a repository</h2>
        <form
          className="mt-5 grid gap-4 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault();
            createRepo.mutate({
              repoOwner,
              repoName,
              slug: slug || undefined,
            });
          }}
        >
          <label className="grid gap-2 text-sm">
            <span>Repository owner</span>
            <Input
              placeholder="octocat"
              value={repoOwner}
              onChange={(event) => setRepoOwner(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span>Repository name</span>
            <Input
              placeholder="hello-world"
              value={repoName}
              onChange={(event) => setRepoName(event.target.value)}
              required
            />
          </label>
          <label className="grid gap-2 text-sm">
            <span>Custom slug</span>
            <Input
              placeholder="hello-world"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
            />
          </label>
          <div className="md:col-span-3">
            <Button disabled={createRepo.isPending} type="submit">
              {createRepo.isPending ? "Connecting repository..." : "Connect repository"}
            </Button>
          </div>
        </form>
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
