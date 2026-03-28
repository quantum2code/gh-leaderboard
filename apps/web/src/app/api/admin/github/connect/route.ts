import crypto from "crypto";
import { auth } from "@gh-leaderboard/auth";
import { isAdminEmail } from "@gh-leaderboard/auth/admin";
import { env } from "@gh-leaderboard/env/server";
import { NextRequest, NextResponse } from "next/server";

const GITHUB_OAUTH_STATE_COOKIE = "gh_admin_github_oauth_state";

function getAdminRedirectUrl(req: NextRequest, params?: Record<string, string>) {
  const url = new URL("/admin", req.url);

  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }

  return url;
}

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({
    headers: req.headers,
  });

  if (!session?.user || !isAdminEmail(session.user.email)) {
    return NextResponse.redirect(getAdminRedirectUrl(req, { github: "forbidden" }));
  }

  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET) {
    return NextResponse.redirect(getAdminRedirectUrl(req, { github: "missing-config" }));
  }

  const state = crypto.randomUUID();
  const callbackUrl = new URL("/api/admin/github/callback", env.BETTER_AUTH_URL);
  const githubAuthorizeUrl = new URL("https://github.com/login/oauth/authorize");
  githubAuthorizeUrl.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  githubAuthorizeUrl.searchParams.set("redirect_uri", callbackUrl.toString());
  githubAuthorizeUrl.searchParams.set("scope", "repo admin:repo_hook read:user");
  githubAuthorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(githubAuthorizeUrl);
  response.cookies.set({
    name: GITHUB_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10,
  });

  return response;
}
