import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema, type Db } from "@db/client";
import type { ForkOption } from "@shared/forks";

export type Owned<T> = { ok: true; value: T } | { ok: false; error: "not_found" | "forbidden" };

function lookup(db: Db, userId: string, messageId: string): Owned<{ forkOptions: ForkOption[] | null }> {
  const row = db
    .select({ userId: schema.chats.userId, forkOptions: schema.messages.forkOptions })
    .from(schema.messages)
    .innerJoin(schema.chats, eq(schema.chats.id, schema.messages.chatId))
    .where(eq(schema.messages.id, messageId))
    .get();
  if (!row) return { ok: false, error: "not_found" };
  if (row.userId !== userId) return { ok: false, error: "forbidden" };
  return { ok: true, value: { forkOptions: row.forkOptions ?? null } };
}

export function checkMessageOwner(userId: string, messageId: string, db: Db = getDb()): Owned<null> {
  const found = lookup(db, userId, messageId);
  return found.ok ? { ok: true, value: null } : found;
}

/** The stored options: null when detection has not run, [] when the reply had none. */
export function messageForkOptions(userId: string, messageId: string, db: Db = getDb()): Owned<ForkOption[] | null> {
  const found = lookup(db, userId, messageId);
  return found.ok ? { ok: true, value: found.value.forkOptions } : found;
}
