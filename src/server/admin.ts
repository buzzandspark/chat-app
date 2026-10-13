import "server-only";
import { desc, eq, ne } from "drizzle-orm";
import { getDb, schema, type Db } from "@db/client";
import { uuidv7 } from "@shared/id";
import { env } from "@shared/env";
import { capColumn, newUserCap, type CapField } from "@shared/cost-cap";

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

/** The one admin table. */
export function listUsersForAdmin(): AdminUserRow[] {
  const db = getDb();
  // Guests are anonymous visitors, not accounts to manage.
  const users = db.select().from(schema.users).where(ne(schema.users.role, "guest")).orderBy(desc(schema.users.createdAt)).all();
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

export function findUser(id: string, db: Db = getDb()): schema.User | undefined {
  return db.select().from(schema.users).where(eq(schema.users.id, id)).get();
}

/** A passwordless account for an invite; null when the email is taken. */
export function createUser(input: { email: string; name?: string; costCapUsd?: CapField }, db: Db = getDb()): string | null {
  const email = input.email.toLowerCase();
  if (db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).get()) return null;
  const id = uuidv7();
  const now = new Date();
  db.insert(schema.users)
    .values({
      id,
      email,
      name: input.name || (email.split("@")[0] ?? "user"),
      emailVerified: false,
      role: "user",
      costCapUsd: newUserCap(input.costCapUsd, env.DEFAULT_COST_CAP_USD),
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

export interface UserPatch {
  costCapUsd?: CapField;
  banned?: boolean;
  role?: "admin" | "user";
}

/** A ban also ends the user's sessions; stop their running replies first. */
export function updateUser(id: string, patch: UserPatch, db: Db = getDb()): void {
  db.transaction((tx) => {
    tx.update(schema.users)
      .set({
        ...(patch.costCapUsd !== undefined ? { costCapUsd: capColumn(patch.costCapUsd) } : {}),
        ...(patch.banned !== undefined ? { banned: patch.banned, banReason: patch.banned ? "Disabled by admin" : null } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.users.id, id))
      .run();
    if (patch.banned) tx.delete(schema.sessions).where(eq(schema.sessions.userId, id)).run();
  });
}

/** Everything the user owns cascades; stop their running replies first. */
export function deleteUser(id: string, db: Db = getDb()): boolean {
  return db.delete(schema.users).where(eq(schema.users.id, id)).run().changes > 0;
}
