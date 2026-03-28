import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_AUTH_TOKEN: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    CORS_ORIGIN: z.string().default(""),
    ADMIN_EMAILS: z.string().default(""),
    GITHUB_CLIENT_ID: z.string().default(""),
    GITHUB_CLIENT_SECRET: z.string().default(""),
    GITHUB_WEBHOOK_PUBLIC_URL: z.string().url().optional(),
    GITHUB_REPO_OWNER: z.string().default(""),
    GITHUB_REPO_NAME: z.string().default(""),
    GITHUB_WEBHOOK_SECRET: z.string().min(1),
    INNGEST_EVENT_KEY: z.string().default(""),
    INNGEST_SIGNING_KEY: z.string().default(""),
    INNGEST_BASE_URL: z.string().url().optional(),
    INNGEST_DEV: z.string().default(""),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
