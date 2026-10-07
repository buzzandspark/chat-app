import { eq } from "drizzle-orm";
import { openDatabase, schema } from "./client";

/** Dev user for running without sign-in (D6); idempotent. The admin is seeded by the auth bootstrap. */
export function seedDevUser(userId: string = process.env.DEV_USER_ID ?? "dev-user"): void {
  const { db } = openDatabase();
  const existing = db.select().from(schema.users).where(eq(schema.users.id, userId)).get();
  if (existing) return;
  db.insert(schema.users)
    .values({
      id: userId,
      name: "Dev User",
      email: `${userId}@example.com`,
      emailVerified: true,
      role: "user",
    })
    .run();
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  seedDevUser();
  console.log("seeded");
}
