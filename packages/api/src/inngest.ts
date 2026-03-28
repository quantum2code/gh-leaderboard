import { db } from "@gh-leaderboard/db";
import { eq, sql } from "@gh-leaderboard/db/drizzle";
import { commits, repositories } from "@gh-leaderboard/db/schema/github";
import { Inngest } from "inngest";

import {
  REPO_SYNC_STATUS,
  fetchRecentCommits,
  fetchRepositoryMetadata,
  getTrackedRepositoryById,
  ingestCommitsForRepository,
  markRepositorySyncState,
} from "./github-sync";

export const inngest = new Inngest({ id: "gh-leaderboard" });

export const syncTrackedRepo = inngest.createFunction(
  {
    id: "sync-tracked-repo",
    triggers: [{ event: "repo/connected" }],
  },
  async ({ event, step }) => {
    const repoId =
      typeof event.data?.repoId === "string" ? event.data.repoId.trim() : "";

    if (!repoId) {
      throw new Error("Missing repoId in repo/connected event payload");
    }

    try {
      const trackedRepo = await step.run("load-repository", async () => {
        const repo = await getTrackedRepositoryById(repoId);

        if (!repo) {
          throw new Error(`Repository ${repoId} not found`);
        }

        return repo;
      });

      const metadata = await step.run("fetch-repository-metadata", async () => {
        return fetchRepositoryMetadata(trackedRepo.name);
      });

      await step.run("persist-repository-metadata", async () => {
        await markRepositorySyncState(trackedRepo.id, {
          defaultBranch: metadata.defaultBranch,
          lastSyncError: null,
        });
      });

      const commitCount = await step.run("count-existing-commits", async () => {
        const rows = await db
          .select({
            count: sql<number>`count(*)`,
          })
          .from(commits)
          .where(eq(commits.repoId, trackedRepo.id));

        return rows[0]?.count ?? 0;
      });

      if (trackedRepo.syncStatus === REPO_SYNC_STATUS.ready && commitCount > 0) {
        return {
          ok: true,
          skipped: true,
        };
      }

      await step.run("mark-backfilling", async () => {
        await markRepositorySyncState(trackedRepo.id, {
          defaultBranch: metadata.defaultBranch,
          syncStatus: REPO_SYNC_STATUS.backfilling,
          backfillCursor: metadata.defaultBranch,
          lastSyncError: null,
        });
      });

      const recentCommits = await step.run("backfill-recent-commits", async () => {
        return fetchRecentCommits(trackedRepo.name, metadata.defaultBranch, 100);
      });

      await step.run("ingest-backfill-batch", async () => {
        const freshRepo = await getTrackedRepositoryById(trackedRepo.id);

        if (!freshRepo) {
          throw new Error(`Repository ${trackedRepo.id} disappeared during sync`);
        }

        await ingestCommitsForRepository({
          repository: freshRepo,
          commits: recentCommits.map((commit) => ({
            ...commit,
            timestamp: new Date(commit.timestamp),
          })),
          lastCommitSha: recentCommits[0]?.sha ?? freshRepo.lastCommitSha,
        });
      });

      await step.run("mark-ready", async () => {
        await db
          .update(repositories)
          .set({
            defaultBranch: metadata.defaultBranch,
            syncStatus: REPO_SYNC_STATUS.ready,
            backfillCursor: null,
            backfillCompletedAt: new Date(),
            lastSyncError: null,
          })
          .where(eq(repositories.id, trackedRepo.id));
      });

      return {
        ok: true,
        synced: recentCommits.length,
      };
    } catch (error) {
      await markRepositorySyncState(repoId, {
        syncStatus: REPO_SYNC_STATUS.failed,
        lastSyncError: error instanceof Error ? error.message : "Unknown sync failure",
      });

      throw error;
    }
  },
);

export const inngestFunctions = [syncTrackedRepo];
