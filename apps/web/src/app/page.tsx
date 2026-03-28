import { db } from "@gh-leaderboard/db";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const repos = await db.query.repositories.findMany({
    columns: {
      slug: true,
      name: true,
    },
    where: (repositories, { eq }) => eq(repositories.isTracked, true),
    orderBy: (repositories, { asc }) => [asc(repositories.name)],
  });

  if (repos[0]) {
    redirect(`/leaderboard/${repos[0].slug}`);
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-3xl flex-col justify-center gap-6 px-4 py-10">
      <section className="rounded-3xl border bg-gradient-to-br from-neutral-950 to-neutral-800 p-8 text-white">
        <p className="text-sm uppercase tracking-[0.25em] text-white/65">
          GitHub Commit Leaderboard
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">
          No tracked repositories yet
        </h1>
        <p className="mt-4 max-w-2xl text-sm text-white/75">
          Connect your first tracked repository from the admin area. The app
          will backfill recent history and keep the matching leaderboard route
          updated from GitHub push webhooks.
        </p>
      </section>

      <div className="rounded-2xl border p-5 text-sm text-muted-foreground">
        Admins can add repositories from <Link className="font-medium text-foreground underline" href="/admin">/admin</Link>.
      </div>
    </main>
  );
}
