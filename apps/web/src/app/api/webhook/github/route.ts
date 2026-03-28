import crypto from "crypto";
import {
  enrichCommitsWithStats,
  getTrackedRepositoryByNameIfTracked,
  ingestCommitsForRepository,
  normalizeWebhookCommits,
} from "@gh-leaderboard/api/github-sync";
import { getGitHubAdminAccessToken } from "@gh-leaderboard/api/github-admin";
import { env } from "@gh-leaderboard/env/server";
import { NextRequest, NextResponse } from "next/server";

const secret = env.GITHUB_WEBHOOK_SECRET;

function verifySignature(payload: string, signature: string | null) {
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", secret);
  const digest = `sha256=${hmac.update(payload).digest("hex")}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}

type PushPayload = {
  ref?: string;
  after?: string;
  repository?: {
    name?: string;
    full_name?: string;
    owner?: {
      login?: string;
      name?: string;
    };
  };
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
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  const event = req.headers.get("x-github-event");

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (event !== "push") {
    return NextResponse.json({ ok: true, ignored: true, event });
  }

  const payload = JSON.parse(rawBody) as PushPayload;
  const repoName =
    payload.repository?.full_name ??
    (payload.repository?.name && payload.repository?.owner
      ? `${payload.repository.owner.login ?? payload.repository.owner.name}/${payload.repository.name}`
      : undefined);

  if (!repoName) {
    return NextResponse.json({ ok: true, ignored: true, reason: "Missing repository name" });
  }

  const trackedRepo = await getTrackedRepositoryByNameIfTracked(repoName);

  if (!trackedRepo) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "Repository is not registered for tracking",
    });
  }

  const normalizedCommits = normalizeWebhookCommits(payload);
  const githubAccessToken = await getGitHubAdminAccessToken();
  const enrichedCommits = await enrichCommitsWithStats(
    repoName,
    normalizedCommits,
    githubAccessToken,
  );

  const result = await ingestCommitsForRepository({
    repository: trackedRepo,
    commits: enrichedCommits,
    lastCommitSha: payload.after ?? trackedRepo.lastCommitSha,
  });

  return NextResponse.json({ ok: true, inserted: result.seen });
}
