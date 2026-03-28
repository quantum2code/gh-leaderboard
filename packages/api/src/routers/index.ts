import crypto from "crypto";
import { db } from "@gh-leaderboard/db";
import { asc, desc, eq, sql } from "@gh-leaderboard/db/drizzle";
import { isAdminEmail } from "@gh-leaderboard/auth/admin";
import { committers, commits, repositories } from "@gh-leaderboard/db/schema/github";
import { z } from "zod";

import { adminProcedure, protectedProcedure, publicProcedure, router } from "../index";
import {
  getGitHubAdminConnection,
  listGitHubRepositoriesForAdmin,
} from "../github-admin";
import { REPO_SYNC_STATUS, slugifyRepoName, splitRepoName } from "../github-sync";
import { inngest as appInngest } from "../inngest";

async function getAvailableSlug(baseValue: string) {
  const baseSlug = slugifyRepoName(baseValue);

  if (!baseSlug) {
    throw new Error("A valid slug is required");
  }

  const existing = await db.query.repositories.findMany({
    columns: {
      slug: true,
    },
  });

  const usedSlugs = new Set(existing.map((repo) => repo.slug));

  if (!usedSlugs.has(baseSlug)) {
    return baseSlug;
  }

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${baseSlug}-${index}`;

    if (!usedSlugs.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique repository slug");
}

async function upsertTrackedRepository({
  createdByEmail,
  fullRepoName,
  preferredSlug,
}: {
  createdByEmail: string;
  fullRepoName: string;
  preferredSlug?: string;
}) {
  const existingRepo = await db.query.repositories.findFirst({
    where: eq(repositories.name, fullRepoName),
  });

  if (existingRepo) {
    const nextSlug =
      existingRepo.slug || (await getAvailableSlug(preferredSlug ?? fullRepoName));

    await db
      .update(repositories)
      .set({
        slug: nextSlug,
        isTracked: true,
        syncStatus:
          existingRepo.syncStatus === REPO_SYNC_STATUS.ready
            ? existingRepo.syncStatus
            : REPO_SYNC_STATUS.pending,
        lastSyncError: null,
      })
      .where(eq(repositories.id, existingRepo.id));

    return {
      repo: {
        ...existingRepo,
        slug: nextSlug,
        isTracked: true,
        syncStatus:
          existingRepo.syncStatus === REPO_SYNC_STATUS.ready
            ? existingRepo.syncStatus
            : REPO_SYNC_STATUS.pending,
        lastSyncError: null,
      },
      created: false,
    };
  }

  const slug = await getAvailableSlug(preferredSlug ?? fullRepoName);
  const trackedRepo = (
    await db
      .insert(repositories)
      .values({
        id: crypto.randomUUID(),
        slug,
        name: fullRepoName,
        isTracked: true,
        createdByEmail,
        syncStatus: REPO_SYNC_STATUS.pending,
      })
      .returning()
  )[0];

  if (!trackedRepo) {
    throw new Error("Unable to create tracked repository");
  }

  return {
    repo: trackedRepo,
    created: true,
  };
}

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  listTrackedRepos: publicProcedure.query(async () => {
    const repos = await db
      .select({
        slug: repositories.slug,
        name: repositories.name,
        isTracked: repositories.isTracked,
        syncStatus: repositories.syncStatus,
        backfillCompletedAt: repositories.backfillCompletedAt,
        webhookEnabledAt: repositories.webhookEnabledAt,
        lastSyncError: repositories.lastSyncError,
        lastSyncedAt: repositories.lastSyncedAt,
        lastCommitSha: repositories.lastCommitSha,
        createdAt: repositories.createdAt,
      })
      .from(repositories)
      .where(eq(repositories.isTracked, true))
      .orderBy(asc(repositories.name));

    return repos.map((repo) => ({
      ...repo,
      ...splitRepoName(repo.name),
    }));
  }),
  commitLeaderboard: publicProcedure
    .input(
      z.object({
        slug: z.string().min(1),
      }),
    )
    .query(async ({ input }) => {
      const trackedRepo = await db.query.repositories.findFirst({
        where: eq(repositories.slug, input.slug),
      });

      if (!trackedRepo) {
        return null;
      }

      const rows = await db
        .select({
          authorKey: sql<string>`coalesce(${committers.username}, ${commits.authorEmail}, ${committers.email}, ${committers.name}, 'unknown')`,
          displayName: sql<string>`coalesce(${committers.name}, ${committers.username}, ${commits.authorEmail}, ${committers.email}, 'Unknown author')`,
          commitCount: sql<number>`count(*)`,
          lastCommitAt: sql<number>`max(${commits.timestamp})`,
          additions: sql<number>`coalesce(sum(${commits.additions}), 0)`,
          deletions: sql<number>`coalesce(sum(${commits.deletions}), 0)`,
        })
        .from(commits)
        .leftJoin(committers, eq(commits.authorId, committers.id))
        .where(eq(commits.repoId, trackedRepo.id))
        .groupBy(
          sql`coalesce(${committers.username}, ${commits.authorEmail}, ${committers.email}, ${committers.name}, 'unknown')`,
          sql`coalesce(${committers.name}, ${committers.username}, ${commits.authorEmail}, ${committers.email}, 'Unknown author')`,
        )
        .orderBy(desc(sql`count(*)`), desc(sql`max(${commits.timestamp})`))
        .limit(25);

      const totals = await db
        .select({
          totalCommits: sql<number>`count(*)`,
          totalAdditions: sql<number>`coalesce(sum(${commits.additions}), 0)`,
          totalDeletions: sql<number>`coalesce(sum(${commits.deletions}), 0)`,
        })
        .from(commits)
        .where(eq(commits.repoId, trackedRepo.id));

      const { repoOwner, repoName } = splitRepoName(trackedRepo.name);

      return {
        slug: trackedRepo.slug,
        repoName: trackedRepo.name,
        repoOwner,
        repoShortName: repoName,
        isTracked: trackedRepo.isTracked,
        syncStatus: trackedRepo.syncStatus,
        backfillCompletedAt: trackedRepo.backfillCompletedAt,
        webhookEnabledAt: trackedRepo.webhookEnabledAt,
        lastSyncError: trackedRepo.lastSyncError,
        lastSyncedAt: trackedRepo.lastSyncedAt,
        lastCommitSha: trackedRepo.lastCommitSha,
        totalCommits: totals[0]?.totalCommits ?? 0,
        totalAdditions: totals[0]?.totalAdditions ?? 0,
        totalDeletions: totals[0]?.totalDeletions ?? 0,
        entries: rows.map((row, index) => ({
          rank: index + 1,
          authorKey: row.authorKey,
          displayName: row.displayName,
          commitCount: row.commitCount,
          lastCommitAt: row.lastCommitAt,
          additions: row.additions,
          deletions: row.deletions,
        })),
      };
    }),
  connectTrackedRepo: adminProcedure
    .input(
      z.object({
        repoOwner: z.string().trim().min(1),
        repoName: z.string().trim().min(1),
        slug: z
          .string()
          .trim()
          .min(1)
          .optional()
          .transform((value) => value?.trim() || undefined),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const repoOwner = input.repoOwner.trim();
      const repoName = input.repoName.trim();
      const fullRepoName = `${repoOwner}/${repoName}`;
      const { repo: trackedRepo } = await upsertTrackedRepository({
        createdByEmail: ctx.session.user.email,
        fullRepoName,
        preferredSlug: input.slug ?? fullRepoName,
      });

      const shouldBackfill =
        trackedRepo.syncStatus !== REPO_SYNC_STATUS.ready ||
        !trackedRepo.lastSyncedAt;
      const shouldEnableWebhook = !trackedRepo.webhookEnabledAt;
      const shouldQueueSync = shouldBackfill || shouldEnableWebhook;

      if (shouldQueueSync) {
        await appInngest.send({
          name: "repo/connected",
          data: {
            repoId: trackedRepo.id,
          },
        });
      }

      return {
        slug: trackedRepo.slug,
        repoOwner,
        repoName,
        name: fullRepoName,
        syncStatus: shouldBackfill ? REPO_SYNC_STATUS.pending : trackedRepo.syncStatus,
        queuedBackfill: shouldBackfill,
        queuedWebhookSetup: shouldEnableWebhook,
      };
    }),
  githubAdminConnection: adminProcedure.query(async () => {
    const connection = await getGitHubAdminConnection();

    if (!connection) {
      return {
        connected: false,
      };
    }

    return {
      connected: true,
      githubLogin: connection.githubLogin,
      connectedByEmail: connection.connectedByEmail,
      connectedAt: connection.updatedAt,
      scope: connection.scope,
    };
  }),
  listGitHubRepositories: adminProcedure.query(async () => {
    const connection = await getGitHubAdminConnection();

    if (!connection) {
      return {
        connected: false,
        repositories: [],
      };
    }

    return {
      connected: true,
      repositories: await listGitHubRepositoriesForAdmin(),
    };
  }),
  connectGitHubRepositories: adminProcedure
    .input(
      z.object({
        repositories: z.array(z.string().trim().min(1)).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const connectedRepos = [];

      for (const fullRepoName of input.repositories) {
        const normalizedRepoName = fullRepoName.trim();
        const { repo } = await upsertTrackedRepository({
          createdByEmail: ctx.session.user.email,
          fullRepoName: normalizedRepoName,
          preferredSlug: normalizedRepoName,
        });

        const shouldBackfill =
          repo.syncStatus !== REPO_SYNC_STATUS.ready ||
          !repo.lastSyncedAt;
        const shouldEnableWebhook = !repo.webhookEnabledAt;

        if (shouldBackfill || shouldEnableWebhook) {
          await appInngest.send({
            name: "repo/connected",
            data: {
              repoId: repo.id,
            },
          });
        }

        connectedRepos.push({
          slug: repo.slug,
          name: normalizedRepoName,
          queuedBackfill: shouldBackfill,
          queuedWebhookSetup: shouldEnableWebhook,
        });
      }

      return {
        count: connectedRepos.length,
        repositories: connectedRepos,
      };
    }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
      isAdmin: isAdminEmail(ctx.session.user.email),
    };
  }),
});
export type AppRouter = typeof appRouter;
