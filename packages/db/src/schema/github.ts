import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const repositories = sqliteTable(
  "repository",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    isTracked: integer("is_tracked", { mode: "boolean" }).default(true).notNull(),
    defaultBranch: text("default_branch"),
    syncStatus: text("sync_status").default("pending").notNull(),
    backfillCursor: text("backfill_cursor"),
    backfillCompletedAt: integer("backfill_completed_at", { mode: "timestamp_ms" }),
    webhookEnabledAt: integer("webhook_enabled_at", { mode: "timestamp_ms" }),
    lastSyncError: text("last_sync_error"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp_ms" }),
    lastCommitSha: text("last_commit_sha"),
    createdByEmail: text("created_by_email").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    uniqueIndex("repository_slug_idx").on(table.slug),
    uniqueIndex("repository_name_idx").on(table.name),
    index("repository_tracking_idx").on(table.isTracked),
    index("repository_sync_status_idx").on(table.syncStatus),
  ],
);

export const githubAdminConnections = sqliteTable(
  "github_admin_connection",
  {
    id: text("id").primaryKey(),
    githubUserId: text("github_user_id"),
    githubLogin: text("github_login"),
    accessToken: text("access_token").notNull(),
    tokenType: text("token_type"),
    scope: text("scope"),
    connectedByEmail: text("connected_by_email").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("github_admin_connection_login_idx").on(table.githubLogin)],
);

export const committers = sqliteTable(
  "committer",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email"),
    username: text("username"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("committer_email_idx").on(table.email),
    index("committer_username_idx").on(table.username),
    index("committer_name_idx").on(table.name),
  ],
);

export const commits = sqliteTable(
  "commit",
  {
    sha: text("sha").primaryKey(),
    repoId: text("repo_id").notNull().references(() => repositories.id),
    authorId: text("author_id").references(() => committers.id),
    authorEmail: text("author_email"),
    message: text("message").notNull(),
    branch: text("branch").notNull(),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
    additions: integer("additions").default(0).notNull(),
    deletions: integer("deletions").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("commit_repo_timestamp_idx").on(table.repoId, table.timestamp),
    index("commit_author_idx").on(table.authorId),
    index("commit_branch_idx").on(table.branch),
  ],
);
