import { eq } from "drizzle-orm";
import { openDatabase, schema } from "./client";

/**
 * Seeds the dev user that build steps 2-5 run against (D6). Idempotent.
 * The first admin is created by the auth bootstrap in step 6.
 */
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
