import { env } from "@gh-leaderboard/env/server";
import { db } from "@gh-leaderboard/db";
import { githubCommits } from "@gh-leaderboard/db/schema/github";
import { and, desc, eq, sql } from "drizzle-orm";

import { protectedProcedure, publicProcedure, router } from "../index";

export const appRouter = router({
  healthCheck: publicProcedure.query(() => {
    return "OK";
  }),
  commitLeaderboard: publicProcedure.query(async () => {
    const rows = await db
      .select({
        authorKey: sql<string>`coalesce(${githubCommits.authorUsername}, ${githubCommits.authorEmail}, ${githubCommits.authorName})`,
        displayName: sql<string>`coalesce(${githubCommits.authorName}, ${githubCommits.authorUsername}, ${githubCommits.authorEmail})`,
        commitCount: sql<number>`count(*)`,
        lastCommitAt: sql<number>`max(${githubCommits.committedAt})`,
      })
      .from(githubCommits)
      .where(and(eq(githubCommits.repoOwner, env.GITHUB_REPO_OWNER), eq(githubCommits.repoName, env.GITHUB_REPO_NAME)))
      .groupBy(
        sql`coalesce(${githubCommits.authorUsername}, ${githubCommits.authorEmail}, ${githubCommits.authorName})`,
        sql`coalesce(${githubCommits.authorName}, ${githubCommits.authorUsername}, ${githubCommits.authorEmail})`,
      )
      .orderBy(desc(sql`count(*)`), desc(sql`max(${githubCommits.committedAt})`))
      .limit(25);

    const totals = await db
      .select({
        totalCommits: sql<number>`count(*)`,
      })
      .from(githubCommits)
      .where(and(eq(githubCommits.repoOwner, env.GITHUB_REPO_OWNER), eq(githubCommits.repoName, env.GITHUB_REPO_NAME)));

    return {
      repoOwner: env.GITHUB_REPO_OWNER,
      repoName: env.GITHUB_REPO_NAME,
      totalCommits: totals[0]?.totalCommits ?? 0,
      entries: rows.map((row, index) => ({
        rank: index + 1,
        authorKey: row.authorKey,
        displayName: row.displayName,
        commitCount: row.commitCount,
        lastCommitAt: row.lastCommitAt,
      })),
    };
  }),
  privateData: protectedProcedure.query(({ ctx }) => {
    return {
      message: "This is private",
      user: ctx.session.user,
    };
  }),
});
export type AppRouter = typeof appRouter;
