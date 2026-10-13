import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import type { Db } from "@db/client";
import { sessions, users } from "@db/schema";
import { createTestDb, seedUser } from "@relay/test-utils";
import { createUser, deleteUser, findUser, updateUser } from "./admin";

let db: Db;

beforeEach(() => {
  db = createTestDb();
  seedUser(db, "u1", { email: "taken@example.com", costCapUsd: 5 });
});

describe("createUser", () => {
  it("lowercases the email, names the user from it, and applies the default cap", () => {
    const id = createUser({ email: "New@Example.com" }, db);
    expect(id).not.toBeNull();
    expect(findUser(id ?? "", db)).toMatchObject({ email: "new@example.com", name: "new", role: "user", costCapUsd: 5 });
  });

  it("stores no cap only for the explicit word", () => {
    const id = createUser({ email: "open@example.com", costCapUsd: "none" }, db);
    expect(findUser(id ?? "", db)?.costCapUsd).toBeNull();
  });

  it("refuses a taken email in any case", () => {
    expect(createUser({ email: "TAKEN@example.com" }, db)).toBeNull();
  });
});

describe("updateUser", () => {
  it("changes only the given fields", () => {
    updateUser("u1", { role: "admin" }, db);
    expect(findUser("u1", db)).toMatchObject({ role: "admin", costCapUsd: 5, banned: false });
    updateUser("u1", { costCapUsd: "none" }, db);
    expect(findUser("u1", db)?.costCapUsd).toBeNull();
  });

  it("a ban ends the user's sessions and an unban clears the reason", () => {
    const now = new Date();
    db.insert(sessions).values({ id: "s1", userId: "u1", token: "t1", expiresAt: new Date(now.getTime() + 60_000), createdAt: now, updatedAt: now }).run();
    updateUser("u1", { banned: true }, db);
    expect(findUser("u1", db)).toMatchObject({ banned: true, banReason: "Disabled by admin" });
    expect(db.select().from(sessions).where(eq(sessions.userId, "u1")).all()).toEqual([]);
    updateUser("u1", { banned: false }, db);
    expect(findUser("u1", db)).toMatchObject({ banned: false, banReason: null });
  });
});

describe("deleteUser", () => {
  it("reports whether a user was deleted", () => {
    expect(deleteUser("u1", db)).toBe(true);
    expect(deleteUser("u1", db)).toBe(false);
    expect(db.select().from(users).all()).toEqual([]);
  });
});
