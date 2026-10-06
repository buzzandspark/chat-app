import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { getDb, schema } from "@db/client";
import { uuidv7 } from "@shared/id";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** D23: a random 32-byte token; only its SHA-256 is stored. Revokes earlier open invites for the user. */
export function issueInvite(userId: string): { token: string; expiresAt: Date } {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
  db.transaction((tx) => {
    tx.update(schema.invites)
      .set({ revokedAt: now })
      .where(and(eq(schema.invites.userId, userId), isNull(schema.invites.usedAt), isNull(schema.invites.revokedAt)))
      .run();
    tx.insert(schema.invites).values({ id: uuidv7(), userId, tokenHash: hashToken(token), expiresAt, createdAt: now }).run();
  });
  return { token, expiresAt };
}

export function revokeInvites(userId: string): void {
  getDb()
    .update(schema.invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(schema.invites.userId, userId), isNull(schema.invites.usedAt), isNull(schema.invites.revokedAt)))
    .run();
}

export type InviteLookup =
  | { ok: true; invite: schema.Invite; user: { id: string; email: string; name: string } }
  | { ok: false; reason: "invalid" | "expired" | "used" | "revoked" };

export function lookupInvite(token: string): InviteLookup {
  const db = getDb();
  const invite = db.select().from(schema.invites).where(eq(schema.invites.tokenHash, hashToken(token))).get();
  if (!invite) return { ok: false, reason: "invalid" };
  if (invite.usedAt) return { ok: false, reason: "used" };
  if (invite.revokedAt) return { ok: false, reason: "revoked" };
  if (invite.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  const user = db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, invite.userId))
    .get();
  if (!user) return { ok: false, reason: "invalid" };
  return { ok: true, invite, user };
}

/** Sets (or replaces) the credential account's password and marks the invite used, in one transaction. */
export async function redeemInvite(token: string, password: string): Promise<InviteLookup> {
  const found = lookupInvite(token);
  if (!found.ok) return found;
  const hash = await hashPassword(password);
  const db = getDb();
  const now = new Date();
  db.transaction((tx) => {
    const existing = tx
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(and(eq(schema.accounts.userId, found.user.id), eq(schema.accounts.providerId, "credential")))
      .get();
    if (existing) {
      tx.update(schema.accounts).set({ password: hash, updatedAt: now }).where(eq(schema.accounts.id, existing.id)).run();
    } else {
      tx.insert(schema.accounts)
        .values({
          id: uuidv7(),
          accountId: found.user.id,
          providerId: "credential",
          userId: found.user.id,
          password: hash,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    tx.update(schema.invites).set({ usedAt: now }).where(eq(schema.invites.id, found.invite.id)).run();
    tx.update(schema.users).set({ emailVerified: true, updatedAt: now }).where(eq(schema.users.id, found.user.id)).run();
  });
  return found;
}
