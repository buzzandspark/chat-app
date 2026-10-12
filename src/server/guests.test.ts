import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@db/client";
import { users } from "@db/schema";
import { createTestDb } from "@relay/test-utils";
import { GUEST_IDLE_MS, purgeIdleGuests } from "./guests";

const NOW = new Date("2026-10-12T12:00:00Z");
let db: Db;

function user(id: string, role: "guest" | "user", lastActiveAt: Date | null) {
  db.insert(users).values({ id, name: id, email: `${id}@x.invalid`, role, lastActiveAt, createdAt: new Date(NOW.getTime() - 2 * GUEST_IDLE_MS) }).run();
}

describe("purgeIdleGuests", () => {
  beforeEach(() => {
    db = createTestDb();
  });

  it("deletes guests idle for 30 days, keeps active guests and every account", () => {
    user("idle-guest", "guest", new Date(NOW.getTime() - GUEST_IDLE_MS - 1));
    user("never-active-guest", "guest", null);
    user("active-guest", "guest", new Date(NOW.getTime() - 1000));
    user("idle-account", "user", null);
    expect(purgeIdleGuests(NOW, db)).toBe(2);
    expect(db.select({ id: users.id }).from(users).all().map((u) => u.id).sort()).toEqual(["active-guest", "idle-account"]);
  });
});
