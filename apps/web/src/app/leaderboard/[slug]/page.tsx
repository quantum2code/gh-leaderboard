import LeaderboardPageClient from "./page-client";

export default async function LeaderboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return <LeaderboardPageClient slug={slug} />;
}
