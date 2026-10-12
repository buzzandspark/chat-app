import "server-only";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { getDb, schema } from "@db/client";
import { uuidv7 } from "@shared/id";

/** ADR-0004: the first admin comes from ADMIN_EMAIL / ADMIN_PASSWORD; idempotent, never downgrades. */
export async function seedAdmin(rawEmail: string | undefined, password: string | undefined): Promise<void> {
  // better-auth looks a sign-in up by the lowercased email, so the stored one must be lowercase too.
  const email = rawEmail?.trim().toLowerCase();
  if (!email || !password) return;
  const db = getDb();
  const existing = db
    .select({ id: schema.users.id, role: schema.users.role, email: schema.users.email })
    .from(schema.users)
    .where(sql`lower(${schema.users.email}) = ${email}`)
    .orderBy(sql`${schema.users.email} = ${email} desc`)
    .get();
  const now = new Date();
  if (existing) {
    if (existing.role !== "admin" || existing.email !== email) {
      db.update(schema.users).set({ role: "admin", email, updatedAt: now }).where(eq(schema.users.id, existing.id)).run();
      if (existing.role !== "admin") console.log(`[boot] promoted ${email} to admin`);
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
