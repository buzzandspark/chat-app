import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { AdminConsole } from "@client/components/admin/admin-console";
import { listUsersForAdmin } from "@server/admin";
import { getCurrentUser } from "@server/current-user";
import { guestsBlocked } from "@server/instance-settings";
import { env } from "@shared/env";

/** Titled only for an admin, so the tab doesn't tell anyone else they found the admin page. */
export async function generateMetadata({ params }: PageProps<"/[adminSlug]">): Promise<Metadata> {
  const { adminSlug } = await params;
  if (adminSlug !== env.ADMIN_PATH_SLUG) return {};
  const user = await getCurrentUser();
  return user?.role === "admin" ? { title: "Admin" } : {};
}

/** One page at /${ADMIN_PATH_SLUG}; anyone who is not an admin gets a 404. */
export default function AdminPage({ params }: PageProps<"/[adminSlug]">) {
  return (
    <Suspense fallback={null}>
      <AdminBody params={params} />
    </Suspense>
  );
}

async function AdminBody({ params }: { params: PageProps<"/[adminSlug]">["params"] }) {
  await connection();
  const { adminSlug } = await params;
  if (adminSlug !== env.ADMIN_PATH_SLUG) notFound();
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();
  return <AdminConsole initialUsers={listUsersForAdmin()} selfId={user.id} defaultCapUsd={env.DEFAULT_COST_CAP_USD} initialGuestsBlocked={guestsBlocked()} />;
}
