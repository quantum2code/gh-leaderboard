import { db } from "@gh-leaderboard/db";
import { and, eq, sql } from "@gh-leaderboard/db/drizzle";
import { committers, commits, repositories } from "@gh-leaderboard/db/schema/github";

export const REPO_SYNC_STATUS = {
  pending: "pending",
  backfilling: "backfilling",
  ready: "ready",
  failed: "failed",
} as const;

export type RepoSyncStatus = (typeof REPO_SYNC_STATUS)[keyof typeof REPO_SYNC_STATUS];

export type RepositoryRecord = typeof repositories.$inferSelect;

export type CommitAuthor = {
  name?: string | null;
  email?: string | null;
  username?: string | null;
};

export type NormalizedCommit = {
  sha: string;
  message: string;
  branch: string;
  timestamp: Date;
  additions: number;
  deletions: number;
  author?: CommitAuthor | null;
};

type GitHubRepoResponse = {
  default_branch?: string;
  full_name?: string;
  html_url?: string;
};

type GitHubCommitListItem = {
  sha?: string;
  commit?: {
    message?: string;
    author?: {
      name?: string | null;
      email?: string | null;
      date?: string | null;
    } | null;
  } | null;
  author?: {
    login?: string | null;
  } | null;
};

type GitHubCommitDetailsResponse = {
  sha?: string;
  commit?: {
    message?: string;
    author?: {
      name?: string | null;
      email?: string | null;
      date?: string | null;
    } | null;
  } | null;
  author?: {
    login?: string | null;
  } | null;
  stats?: {
    additions?: number;
    deletions?: number;
  } | null;
};

function getGitHubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "gh-leaderboard-sync",
  };
}

async function fetchGitHub<T>(path: string, init?: RequestInit) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      ...getGitHubHeaders(),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();

    throw new Error(`GitHub API request failed (${response.status}): ${body || response.statusText}`);
  }

  return (await response.json()) as T;
}

function getBranchName(ref: string | undefined) {
  if (!ref) {
    return "unknown";
  }

  return ref.replace(/^refs\/heads\//, "");
}

export function slugifyRepoName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function splitRepoName(value: string) {
  const [repoOwner = value, ...rest] = value.split("/");

  return {
    repoOwner,
    repoName: rest.join("/") || repoOwner,
  };
}

export function getCommitterId(author: CommitAuthor | null | undefined) {
  const base = author?.username ?? author?.email ?? author?.name ?? "unknown";

  return `committer:${base.trim().toLowerCase()}`;
}

export async function getTrackedRepositoryByName(name: string) {
  return db.query.repositories.findFirst({
    where: eq(repositories.name, name),
  });
}

export async function getTrackedRepositoryById(id: string) {
  return db.query.repositories.findFirst({
    where: eq(repositories.id, id),
  });
}

export async function getTrackedRepositoryByNameIfTracked(name: string) {
  return db.query.repositories.findFirst({
    where: and(eq(repositories.name, name), eq(repositories.isTracked, true)),
  });
}

export async function markRepositorySyncState(
  repoId: string,
  updates: Partial<typeof repositories.$inferInsert>,
) {
  await db.update(repositories).set(updates).where(eq(repositories.id, repoId));
}

export async function fetchRepositoryMetadata(fullRepoName: string) {
  const data = await fetchGitHub<GitHubRepoResponse>(`/repos/${fullRepoName}`);

  return {
    defaultBranch: data.default_branch ?? "main",
    fullName: data.full_name ?? fullRepoName,
    htmlUrl: data.html_url ?? `https://github.com/${fullRepoName}`,
  };
}

async function fetchCommitDetails(fullRepoName: string, sha: string) {
  const data = await fetchGitHub<GitHubCommitDetailsResponse>(
    `/repos/${fullRepoName}/commits/${sha}`,
  );

  return {
    sha,
    message: data.commit?.message ?? "",
    timestamp: new Date(data.commit?.author?.date ?? new Date().toISOString()),
    additions: data.stats?.additions ?? 0,
    deletions: data.stats?.deletions ?? 0,
    author: {
      name: data.commit?.author?.name ?? null,
      email: data.commit?.author?.email ?? null,
      username: data.author?.login ?? null,
    },
  };
}

export async function fetchRecentCommits(fullRepoName: string, branch: string, limit = 100) {
  const data = await fetchGitHub<GitHubCommitListItem[]>(
    `/repos/${fullRepoName}/commits?sha=${encodeURIComponent(branch)}&per_page=${Math.min(limit, 100)}`,
  );

  const baseCommits = data.filter(
    (commit): commit is GitHubCommitListItem & { sha: string } =>
      Boolean(commit.sha && commit.commit?.author?.date),
  );

  const details = await Promise.all(
    baseCommits.map(async (commit) => {
      const detail = await fetchCommitDetails(fullRepoName, commit.sha);

      return {
        sha: commit.sha,
        message: detail.message || commit.commit?.message || "",
        timestamp: detail.timestamp,
        additions: detail.additions,
        deletions: detail.deletions,
        branch,
        author: {
          name: detail.author.name ?? commit.commit?.author?.name ?? null,
          email: detail.author.email ?? commit.commit?.author?.email ?? null,
          username: detail.author.username ?? commit.author?.login ?? null,
        },
      } satisfies NormalizedCommit;
    }),
  );

  return details;
}

export async function ingestCommitsForRepository({
  repository: repo,
  commits: incomingCommits,
  lastCommitSha,
  syncedAt = new Date(),
}: {
  repository: RepositoryRecord;
  commits: NormalizedCommit[];
  lastCommitSha?: string | null;
  syncedAt?: Date;
}) {
  const commitRows = incomingCommits.map((commit) => {
    const authorId = getCommitterId(commit.author);

    return {
      sha: commit.sha,
      repoId: repo.id,
      authorId,
      authorEmail: commit.author?.email ?? null,
      message: commit.message,
      branch: commit.branch,
      timestamp: commit.timestamp,
      additions: commit.additions,
      deletions: commit.deletions,
    };
  });

  const committerRows = Array.from(
    new Map(
      incomingCommits.map((commit) => {
        const authorId = getCommitterId(commit.author);

        return [
          authorId,
          {
            id: authorId,
            name: commit.author?.name ?? "Unknown author",
            email: commit.author?.email ?? null,
            username: commit.author?.username ?? null,
            updatedAt: syncedAt,
          },
        ] as const;
      }),
    ).values(),
  );

  await db.transaction(async (tx) => {
    if (committerRows.length > 0) {
      await tx.insert(committers).values(committerRows).onConflictDoUpdate({
        target: committers.id,
        set: {
          name: sql`excluded.name`,
          email: sql`excluded.email`,
          username: sql`excluded.username`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    }

    if (commitRows.length > 0) {
      await tx.insert(commits).values(commitRows).onConflictDoNothing({ target: commits.sha });
    }

    await tx
      .update(repositories)
      .set({
        lastSyncedAt: syncedAt,
        lastCommitSha: lastCommitSha ?? commitRows[0]?.sha ?? repo.lastCommitSha,
      })
      .where(eq(repositories.id, repo.id));
  });

  return {
    seen: commitRows.length,
    lastCommitSha: lastCommitSha ?? commitRows[0]?.sha ?? repo.lastCommitSha,
  };
}

export function normalizeWebhookCommits(payload: {
  ref?: string;
  commits?: Array<{
    id?: string;
    message?: string;
    timestamp?: string;
    author?: {
      name?: string;
      email?: string;
      username?: string;
    };
  }>;
}) {
  return (payload.commits ?? [])
    .filter((commit): commit is NonNullable<typeof payload.commits>[number] & { id: string; timestamp: string } =>
      Boolean(commit.id && commit.timestamp),
    )
    .map((commit) => ({
      sha: commit.id,
      message: commit.message ?? "",
      branch: getBranchName(payload.ref),
      timestamp: new Date(commit.timestamp),
      additions: 0,
      deletions: 0,
      author: {
        name: commit.author?.name ?? null,
        email: commit.author?.email ?? null,
        username: commit.author?.username ?? null,
      },
    }));
}

export async function enrichCommitsWithStats(
  fullRepoName: string,
  commitsToEnrich: NormalizedCommit[],
) {
  const details = await Promise.all(
    commitsToEnrich.map(async (commit) => {
      const detail = await fetchCommitDetails(fullRepoName, commit.sha);

      return {
        ...commit,
        additions: detail.additions,
        deletions: detail.deletions,
        author: {
          name: commit.author?.name ?? detail.author.name ?? null,
          email: commit.author?.email ?? detail.author.email ?? null,
          username: commit.author?.username ?? detail.author.username ?? null,
        },
      } satisfies NormalizedCommit;
    }),
  );

  return details;
}
