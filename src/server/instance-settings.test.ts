import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Db } from "@db/client";
import { createTestDb } from "@relay/test-utils";
import { guestsBlocked, setGuestsBlocked } from "./instance-settings";

let db: Db;

beforeEach(() => {
  db = createTestDb();
});

describe("guestsBlocked", () => {
  it("lets guests in until an admin blocks them, and again once unblocked", () => {
    expect(guestsBlocked(db)).toBe(false);
    setGuestsBlocked(true, db);
    expect(guestsBlocked(db)).toBe(true);
    setGuestsBlocked(false, db);
    expect(guestsBlocked(db)).toBe(false);
  });
});
