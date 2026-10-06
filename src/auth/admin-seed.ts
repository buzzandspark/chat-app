import "server-only";
import { eq } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { getDb, schema } from "@db/client";
import { uuidv7 } from "@shared/id";

/** ADR-0004: the first admin comes from ADMIN_EMAIL / ADMIN_PASSWORD; idempotent, never downgrades. */
export async function seedAdmin(email: string | undefined, password: string | undefined): Promise<void> {
  if (!email || !password) return;
  const db = getDb();
  const existing = db.select({ id: schema.users.id, role: schema.users.role }).from(schema.users).where(eq(schema.users.email, email)).get();
  const now = new Date();
  if (existing) {
    if (existing.role !== "admin") {
      db.update(schema.users).set({ role: "admin", updatedAt: now }).where(eq(schema.users.id, existing.id)).run();
      console.log(`[boot] promoted ${email} to admin`);
    }
    return;
  }
  const id = uuidv7();
  const hash = await hashPassword(password);
  db.transaction((tx) => {
    tx.insert(schema.users)
      .values({ id, name: email.split("@")[0] ?? "admin", email, emailVerified: true, role: "admin", createdAt: now, updatedAt: now })
      .run();
    tx.insert(schema.accounts)
      .values({ id: uuidv7(), accountId: id, providerId: "credential", userId: id, password: hash, createdAt: now, updatedAt: now })
      .run();
  });
  console.log(`[boot] seeded admin ${email}`);
}
