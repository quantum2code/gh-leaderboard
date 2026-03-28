import { inngest, inngestFunctions } from "@gh-leaderboard/api/inngest";
import { serve } from "inngest/next";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
