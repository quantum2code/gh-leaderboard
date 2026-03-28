import { db } from "@gh-leaderboard/db";
import { eq, sql } from "@gh-leaderboard/db/drizzle";
import { commits, repositories } from "@gh-leaderboard/db/schema/github";
import { Inngest } from "inngest";

import {
  ensureRepositoryWebhook,
  getGitHubAdminAccessToken,
  getWebhookSetupBlockReason,
} from "./github-admin";
import {
  type NormalizedCommit,
  REPO_SYNC_STATUS,
  fetchRecentCommits,
  fetchRepositoryMetadata,
  getTrackedRepositoryById,
  ingestCommitsForRepository,
  markRepositorySyncState,
} from "./github-sync";

export const inngest = new Inngest({ id: "gh-leaderboard" });

export const syncTrackedRepo: ReturnType<typeof inngest.createFunction> = inngest.createFunction(
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

      const githubAccessToken = await step.run("load-github-admin-token", async () => {
        return getGitHubAdminAccessToken();
      });

      const metadata = await step.run("fetch-repository-metadata", async () => {
        return fetchRepositoryMetadata(trackedRepo.name, githubAccessToken);
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
        if (githubAccessToken) {
          await step.run("enable-webhook-existing-repo", async () => {
            const webhookResult = await ensureRepositoryWebhook(trackedRepo.name, githubAccessToken);

            await markRepositorySyncState(trackedRepo.id, {
              webhookEnabledAt: webhookResult.skipped ? null : new Date(),
              lastSyncError: webhookResult.reason,
            });
          });
        } else {
          await step.run("record-missing-webhook-token-existing-repo", async () => {
            await markRepositorySyncState(trackedRepo.id, {
              webhookEnabledAt: null,
              lastSyncError: getWebhookSetupBlockReason() ?? "Webhook setup skipped: connect a GitHub admin account first.",
            });
          });
        }

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
        return fetchRecentCommits(trackedRepo.name, metadata.defaultBranch, 100, githubAccessToken);
      });

      await step.run("ingest-backfill-batch", async () => {
        const freshRepo = await getTrackedRepositoryById(trackedRepo.id);

        if (!freshRepo) {
          throw new Error(`Repository ${trackedRepo.id} disappeared during sync`);
        }

        await ingestCommitsForRepository({
          repository: freshRepo,
          commits: recentCommits.map((commit: NormalizedCommit) => ({
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

      if (githubAccessToken) {
        await step.run("enable-webhook-after-backfill", async () => {
          const webhookResult = await ensureRepositoryWebhook(trackedRepo.name, githubAccessToken);

          await markRepositorySyncState(trackedRepo.id, {
            webhookEnabledAt: webhookResult.skipped ? null : new Date(),
            lastSyncError: webhookResult.reason,
          });
        });
      } else {
        await step.run("record-missing-webhook-token-after-backfill", async () => {
          await markRepositorySyncState(trackedRepo.id, {
            webhookEnabledAt: null,
            lastSyncError: getWebhookSetupBlockReason() ?? "Webhook setup skipped: connect a GitHub admin account first.",
          });
        });
      }

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

export const inngestFunctions: Array<ReturnType<typeof inngest.createFunction>> = [syncTrackedRepo];
