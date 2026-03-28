import crypto from "crypto";
import { db } from "@gh-leaderboard/db";
import { githubCommits } from "@gh-leaderboard/db/schema/github";
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
  repository?: {
    name?: string;
    owner?: {
      login?: string;
      name?: string;
    };
  };
  commits?: Array<{
    id: string;
    message: string;
    timestamp: string;
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
  const repoName = payload.repository?.name;
  const repoOwner =
    payload.repository?.owner?.login ?? payload.repository?.owner?.name;

  if (
    repoName !== env.GITHUB_REPO_NAME ||
    repoOwner !== env.GITHUB_REPO_OWNER
  ) {
    return NextResponse.json({
      ok: true,
      ignored: true,
      reason: "Repository does not match configured leaderboard target",
    });
  }

  const commits = (payload.commits ?? [])
    .filter((commit) => Boolean(commit.id && commit.timestamp))
    .map((commit) => ({
      id: crypto.randomUUID(),
      repoOwner,
      repoName,
      commitSha: commit.id,
      authorName: commit.author?.name ?? "Unknown author",
      authorEmail: commit.author?.email ?? null,
      authorUsername: commit.author?.username ?? null,
      message: commit.message,
      committedAt: new Date(commit.timestamp),
    }));

  if (commits.length === 0) {
    return NextResponse.json({ ok: true, inserted: 0 });
  }

  await db
    .insert(githubCommits)
    .values(commits)
    .onConflictDoNothing({ target: githubCommits.commitSha });

  return NextResponse.json({ ok: true, inserted: commits.length });
}
