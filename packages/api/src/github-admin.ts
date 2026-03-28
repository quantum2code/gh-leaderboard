import { db } from "@gh-leaderboard/db";
import { eq } from "@gh-leaderboard/db/drizzle";
import { githubAdminConnections } from "@gh-leaderboard/db/schema/github";
import { env } from "@gh-leaderboard/env/server";

const GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_WEBHOOK_CONNECTION_ID = "global";

type GitHubUserResponse = {
  id?: number;
  login?: string;
};

type GitHubRepoListItem = {
  id?: number;
  name?: string;
  full_name?: string;
  private?: boolean;
  owner?: {
    login?: string;
  } | null;
  permissions?: {
    admin?: boolean;
    push?: boolean;
    pull?: boolean;
  } | null;
};

type GitHubWebhook = {
  id?: number;
  config?: {
    url?: string;
  } | null;
};

export function getGitHubHeaders(accessToken?: string) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "gh-leaderboard-sync",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(accessToken
      ? {
          Authorization: `Bearer ${accessToken}`,
        }
      : {}),
  };
}

export async function fetchGitHub<T>(
  path: string,
  init?: RequestInit & { accessToken?: string },
) {
  const response = await fetch(`${GITHUB_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...getGitHubHeaders(init?.accessToken),
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

export async function getGitHubAdminConnection() {
  return db.query.githubAdminConnections.findFirst({
    where: eq(githubAdminConnections.id, GITHUB_WEBHOOK_CONNECTION_ID),
  });
}

export async function getGitHubAdminAccessToken() {
  const connection = await getGitHubAdminConnection();

  return connection?.accessToken ?? null;
}

export async function upsertGitHubAdminConnection({
  accessToken,
  connectedByEmail,
  scope,
  tokenType,
}: {
  accessToken: string;
  connectedByEmail: string;
  scope?: string | null;
  tokenType?: string | null;
}) {
  const user = await fetchGitHub<GitHubUserResponse>("/user", {
    accessToken,
  });

  await db
    .insert(githubAdminConnections)
    .values({
      id: GITHUB_WEBHOOK_CONNECTION_ID,
      githubUserId: user.id ? String(user.id) : null,
      githubLogin: user.login ?? null,
      accessToken,
      tokenType: tokenType ?? "bearer",
      scope: scope ?? null,
      connectedByEmail,
    })
    .onConflictDoUpdate({
      target: githubAdminConnections.id,
      set: {
        githubUserId: user.id ? String(user.id) : null,
        githubLogin: user.login ?? null,
        accessToken,
        tokenType: tokenType ?? "bearer",
        scope: scope ?? null,
        connectedByEmail,
        updatedAt: new Date(),
      },
    });

  return getGitHubAdminConnection();
}

export async function listGitHubRepositoriesForAdmin() {
  const accessToken = await getGitHubAdminAccessToken();

  if (!accessToken) {
    throw new Error("GitHub is not connected for admin repository access");
  }

  const repos = await fetchGitHub<GitHubRepoListItem[]>(
    "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member&visibility=all",
    {
      accessToken,
    },
  );

  return repos
    .filter((repo): repo is GitHubRepoListItem & { full_name: string; name: string } =>
      Boolean(repo.full_name && repo.name),
    )
    .map((repo) => ({
      id: repo.id ? String(repo.id) : repo.full_name,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner?.login ?? repo.full_name.split("/")[0] ?? "",
      isPrivate: Boolean(repo.private),
      canAdminister: Boolean(repo.permissions?.admin),
      canPush: Boolean(repo.permissions?.push),
    }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName));
}

function getWebhookCallbackUrl() {
  return new URL(
    "/api/webhook/github",
    env.GITHUB_WEBHOOK_PUBLIC_URL ?? env.BETTER_AUTH_URL,
  ).toString();
}

function isLocalHostname(hostname: string) {
  const normalizedHostname = hostname.trim().toLowerCase();

  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "::1" ||
    normalizedHostname.endsWith(".local")
  );
}

export function getWebhookSetupBlockReason() {
  const webhookUrl = getWebhookCallbackUrl();
  const parsedUrl = new URL(webhookUrl);

  if (isLocalHostname(parsedUrl.hostname)) {
    return `Webhook setup skipped: ${webhookUrl} is not reachable from the public Internet. Use a public URL such as ngrok.`;
  }

  return null;
}

export async function ensureRepositoryWebhook(fullRepoName: string, accessToken: string) {
  const webhookUrl = getWebhookCallbackUrl();
  const setupBlockReason = getWebhookSetupBlockReason();

  if (setupBlockReason) {
    return {
      created: false,
      hookId: null,
      skipped: true,
      reason: setupBlockReason,
    };
  }

  const hooks = await fetchGitHub<GitHubWebhook[]>(
    `/repos/${fullRepoName}/hooks?per_page=100`,
    { accessToken },
  );

  const existingHook = hooks.find((hook) => hook.config?.url === webhookUrl);

  if (existingHook?.id) {
    await fetchGitHub(`/repos/${fullRepoName}/hooks/${existingHook.id}`, {
      method: "PATCH",
      accessToken,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        active: true,
        events: ["push"],
        config: {
          url: webhookUrl,
          content_type: "json",
          secret: env.GITHUB_WEBHOOK_SECRET,
          insecure_ssl: "0",
        },
      }),
    });

    return {
      created: false,
      hookId: existingHook.id,
      skipped: false,
      reason: null,
    };
  }

  const createdHook = await fetchGitHub<GitHubWebhook>(`/repos/${fullRepoName}/hooks`, {
    method: "POST",
    accessToken,
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push"],
      config: {
        url: webhookUrl,
        content_type: "json",
        secret: env.GITHUB_WEBHOOK_SECRET,
        insecure_ssl: "0",
      },
    }),
  });

  return {
    created: true,
    hookId: createdHook.id ?? null,
    skipped: false,
    reason: null,
  };
}
