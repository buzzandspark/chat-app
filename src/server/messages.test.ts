import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@db/client";
import { createTestDb, seedChat, seedMessage, seedUser } from "@relay/test-utils";
import { checkMessageOwner, messageForkOptions } from "./messages";

let db: Db;

beforeEach(() => {
  db = createTestDb();
  seedUser(db, "u1");
  seedUser(db, "u2");
  seedChat(db, "c1", "u1");
  seedMessage(db, "m1", "c1", 1, { forkOptions: [{ title: "A", prompt: "Go with A" }] });
  seedMessage(db, "m2", "c1", 3);
});

describe("message ownership", () => {
  it("tells a missing message from someone else's", () => {
    expect(checkMessageOwner("u1", "m1", db)).toEqual({ ok: true, value: null });
    expect(checkMessageOwner("u2", "m1", db)).toEqual({ ok: false, error: "forbidden" });
    expect(checkMessageOwner("u1", "missing", db)).toEqual({ ok: false, error: "not_found" });
  });

  it("returns stored fork options to the owner only, null when none were stored", () => {
    expect(messageForkOptions("u1", "m1", db)).toEqual({ ok: true, value: [{ title: "A", prompt: "Go with A" }] });
    expect(messageForkOptions("u1", "m2", db)).toEqual({ ok: true, value: null });
    expect(messageForkOptions("u2", "m1", db)).toEqual({ ok: false, error: "forbidden" });
  });
});
