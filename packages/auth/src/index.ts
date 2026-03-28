import { createDb } from "@gh-leaderboard/db";
import * as schema from "@gh-leaderboard/db/schema/auth";
import { env } from "@gh-leaderboard/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";

function getTrustedOrigins() {
  const origins = new Set<string>([env.BETTER_AUTH_URL]);

  for (const origin of env.CORS_ORIGIN.split(",")) {
    const normalizedOrigin = origin.trim();

    if (normalizedOrigin.length > 0) {
      origins.add(normalizedOrigin);
    }
  }

  return Array.from(origins);
}

export function createAuth() {
  const db = createDb();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",

      schema: schema,
    }),
    trustedOrigins: getTrustedOrigins(),
    emailAndPassword: {
      enabled: true,
    },
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    plugins: [nextCookies()],
  });
}

export const auth = createAuth();
