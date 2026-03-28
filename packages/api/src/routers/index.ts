import crypto from "crypto";
import { db } from "@gh-leaderboard/db";
import { asc, desc, eq, sql } from "@gh-leaderboard/db/drizzle";
import { isAdminEmail } from "@gh-leaderboard/auth/admin";
import { committers, commits, repositories } from "@gh-leaderboard/db/schema/github";
import { z } from "zod";

import { adminProcedure, protectedProcedure, publicProcedure, router } from "../index";
import { REPO_SYNC_STATUS, slugifyRepoName, splitRepoName } from "../github-sync";
import { inngest as appInngest } from "../inngest";

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
      const slug = slugifyRepoName(input.slug ?? repoName);

      if (!slug) {
        throw new Error("A valid slug is required");
      }

      const existingRepo = await db.query.repositories.findFirst({
        where: eq(repositories.name, fullRepoName),
      });

      const trackedRepo =
        existingRepo ??
        (
          await db
            .insert(repositories)
            .values({
              id: crypto.randomUUID(),
              slug,
              name: fullRepoName,
              isTracked: true,
              createdByEmail: ctx.session.user.email,
              syncStatus: REPO_SYNC_STATUS.pending,
            })
            .returning()
        )[0];

      if (!trackedRepo) {
        throw new Error("Unable to create tracked repository");
      }

      if (existingRepo) {
        await db
          .update(repositories)
          .set({
            isTracked: true,
            syncStatus:
              existingRepo.syncStatus === REPO_SYNC_STATUS.ready
                ? existingRepo.syncStatus
                : REPO_SYNC_STATUS.pending,
            lastSyncError: null,
          })
          .where(eq(repositories.id, existingRepo.id));
      }

      const shouldBackfill =
        trackedRepo.syncStatus !== REPO_SYNC_STATUS.ready ||
        !trackedRepo.lastSyncedAt;

      if (shouldBackfill) {
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
