import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const githubCommits = sqliteTable(
  "github_commit",
  {
    id: text("id").primaryKey(),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    commitSha: text("commit_sha").notNull(),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email"),
    authorUsername: text("author_username"),
    message: text("message").notNull(),
    committedAt: integer("committed_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_commit_sha_idx").on(table.commitSha),
    index("github_commit_repo_idx").on(table.repoOwner, table.repoName),
    index("github_commit_author_idx").on(table.authorUsername, table.authorEmail),
  ],
);
