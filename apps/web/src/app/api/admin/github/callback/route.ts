import { upsertGitHubAdminConnection } from "@gh-leaderboard/api/github-admin";
import { auth } from "@gh-leaderboard/auth";
import { isAdminEmail } from "@gh-leaderboard/auth/admin";
import { env } from "@gh-leaderboard/env/server";
import { NextRequest, NextResponse } from "next/server";

const GITHUB_OAUTH_STATE_COOKIE = "gh_admin_github_oauth_state";

type GitHubTokenResponse = {
  access_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

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

  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const githubError = req.nextUrl.searchParams.get("error");
  const cookieState = req.cookies.get(GITHUB_OAUTH_STATE_COOKIE)?.value;

  if (githubError) {
    return NextResponse.redirect(getAdminRedirectUrl(req, { github: "oauth-denied" }));
  }

  if (!state || !cookieState || state !== cookieState || !code) {
    return NextResponse.redirect(getAdminRedirectUrl(req, { github: "invalid-state" }));
  }

  const callbackUrl = new URL("/api/admin/github/callback", env.BETTER_AUTH_URL);
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl.toString(),
      state,
    }),
    cache: "no-store",
  });

  const tokenPayload = (await tokenResponse.json()) as GitHubTokenResponse;

  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return NextResponse.redirect(
      getAdminRedirectUrl(req, {
        github: tokenPayload.error ? `oauth-${tokenPayload.error}` : "oauth-failed",
      }),
    );
  }

  await upsertGitHubAdminConnection({
    accessToken: tokenPayload.access_token,
    connectedByEmail: session.user.email,
    scope: tokenPayload.scope ?? null,
    tokenType: tokenPayload.token_type ?? null,
  });

  const response = NextResponse.redirect(getAdminRedirectUrl(req, { github: "connected" }));
  response.cookies.set({
    name: GITHUB_OAUTH_STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
