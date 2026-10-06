import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@db/client";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  banned: boolean;
  costCapUsd: number | null;
  costSpentUsd: number;
  lastActiveAt: number | null;
  createdAt: number;
  invite: { expiresAt: number; usedAt: number | null; revokedAt: number | null } | null;
}

/** D7: the one admin table. */
export function listUsersForAdmin(): AdminUserRow[] {
  const db = getDb();
  const users = db.select().from(schema.users).orderBy(desc(schema.users.createdAt)).all();
  const invites = db.select().from(schema.invites).orderBy(desc(schema.invites.createdAt)).all();
  const latestInvite = new Map<string, schema.Invite>();
  for (const inv of invites) if (!latestInvite.has(inv.userId)) latestInvite.set(inv.userId, inv);
  return users.map((u) => {
    const inv = latestInvite.get(u.id);
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      banned: u.banned,
      costCapUsd: u.costCapUsd,
      costSpentUsd: u.costSpentUsd,
      lastActiveAt: u.lastActiveAt?.getTime() ?? null,
      createdAt: u.createdAt.getTime(),
      invite: inv ? { expiresAt: inv.expiresAt.getTime(), usedAt: inv.usedAt?.getTime() ?? null, revokedAt: inv.revokedAt?.getTime() ?? null } : null,
    };
  });
}

export function findUser(id: string): schema.User | undefined {
  return getDb().select().from(schema.users).where(eq(schema.users.id, id)).get();
}
