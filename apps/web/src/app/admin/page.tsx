import { auth } from "@gh-leaderboard/auth";
import { isAdminEmail } from "@gh-leaderboard/auth/admin";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import AdminPanel from "./panel";

export default async function AdminPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  if (!session?.user) {
    redirect("/login");
  }

  if (!isAdminEmail(session.user.email)) {
    redirect("/");
  }

  return <AdminPanel />;
}
