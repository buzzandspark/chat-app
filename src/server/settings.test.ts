import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import type { Db } from "@db/client";
import { usageEvents, users } from "@db/schema";
import { uuidv7 } from "@shared/id";
import { createTestDb, seedUser } from "@relay/test-utils";
import { getUserSettings, monthStart, updateUserSettings, usageSummary } from "./settings";

const USER = "u1";
const NOW = new Date("2026-10-11T12:00:00Z");
const LAST_MONTH = new Date("2026-09-30T23:59:59Z");
let db: Db;

function usage(
  iterationType: string,
  createdAt: Date,
  costUsd: number,
  tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } = {},
  userId = USER,
  model = iterationType.startsWith("options") ? "claude-haiku-5-5" : "claude-sonnet-5-5",
): void {
  db.insert(usageEvents)
    .values({
      id: uuidv7(),
      userId,
      model,
      iterationType,
      inputTokens: tokens.input ?? 0,
      outputTokens: tokens.output ?? 0,
      cacheReadTokens: tokens.cacheRead ?? 0,
      cacheWriteTokens: tokens.cacheWrite ?? 0,
      costUsd,
      createdAt,
    })
    .run();
}

beforeEach(() => {
  db = createTestDb();
  seedUser(db, USER);
});

describe("usageSummary", () => {
  it("is all zeros with no usage, and no cap unless one is set", () => {
    const zero = { costUsd: 0, inputTokens: 0, outputTokens: 0 };
    expect(usageSummary(USER, NOW, db)).toEqual({ month: { chats: zero, explore: zero }, all: { chats: zero, explore: zero }, chatModels: [], spentUsd: 0, capUsd: null });
  });

  it("splits chat replies from Explore's Haiku calls, this month and all time", () => {
    usage("message", NOW, 0.5, { input: 100, output: 50, cacheRead: 1000, cacheWrite: 200 });
    usage("fallback_message", NOW, 0.25, { input: 10, output: 5 });
    usage("message", LAST_MONTH, 1, { input: 400, output: 100 });
    usage("options", NOW, 0.01, { input: 300, output: 20 });
    usage("options_rewrite", LAST_MONTH, 0.02, { input: 30, output: 2 });
    // Another user's spend never counts.
    seedUser(db, "u2");
    usage("message", NOW, 9, { input: 9 }, "u2");

    const s = usageSummary(USER, NOW, db);
    expect(s.month.chats).toEqual({ costUsd: 0.75, inputTokens: 1310, outputTokens: 55 });
    expect(s.all.chats).toEqual({ costUsd: 1.75, inputTokens: 1710, outputTokens: 155 });
    expect(s.month.explore).toEqual({ costUsd: 0.01, inputTokens: 300, outputTokens: 20 });
    expect(s.all.explore.costUsd).toBeCloseTo(0.03);
    expect(s.all.explore).toMatchObject({ inputTokens: 330, outputTokens: 22 });
  });

  it("breaks the chats total down by model, most spent first; Explore's Haiku calls stay out of it", () => {
    usage("message", NOW, 0.5, { input: 100, output: 10 });
    usage("message", LAST_MONTH, 3, { input: 50, output: 5 }, USER, "claude-opus-5-5");
    usage("fallback_message", NOW, 0.2, { input: 20, output: 2 }, USER, "claude-haiku-5-5");
    usage("options", NOW, 0.01, { input: 300, output: 20 });
    expect(usageSummary(USER, NOW, db).chatModels).toEqual([
      { model: "claude-opus-5-5", label: "Opus 5.5", month: { costUsd: 0, inputTokens: 0, outputTokens: 0 }, all: { costUsd: 3, inputTokens: 50, outputTokens: 5 } },
      { model: "claude-sonnet-5-5", label: "Sonnet 5.5", month: { costUsd: 0.5, inputTokens: 100, outputTokens: 10 }, all: { costUsd: 0.5, inputTokens: 100, outputTokens: 10 } },
      { model: "claude-haiku-5-5", label: "Haiku 5.5", month: { costUsd: 0.2, inputTokens: 20, outputTokens: 2 }, all: { costUsd: 0.2, inputTokens: 20, outputTokens: 2 } },
    ]);
  });

  it("reports the cap against the cap's own counter", () => {
    db.update(users).set({ costCapUsd: 10, costSpentUsd: 4.2 }).where(eq(users.id, USER)).run();
    usage("message", NOW, 1);
    expect(usageSummary(USER, NOW, db)).toMatchObject({ capUsd: 10, spentUsd: 4.2 });
  });

  it("starts the month at midnight UTC on the first", () => {
    expect(monthStart(NOW).toISOString()).toBe("2026-10-01T00:00:00.000Z");
    usage("message", monthStart(NOW), 1);
    usage("message", new Date(monthStart(NOW).getTime() - 1), 2);
    expect(usageSummary(USER, NOW, db).month.chats.costUsd).toBe(1);
  });
});

describe("user settings", () => {
  it("Explore options default on, and an update sticks", () => {
    expect(getUserSettings(USER, db)).toEqual({ exploreOptions: true });
    expect(updateUserSettings(USER, { exploreOptions: false }, db)).toBe(true);
    expect(getUserSettings(USER, db)).toEqual({ exploreOptions: false });
    expect(updateUserSettings(USER, { exploreOptions: true }, db)).toBe(true);
    expect(getUserSettings(USER, db)).toEqual({ exploreOptions: true });
  });

  it("an update for an unknown user changes nothing", () => {
    expect(updateUserSettings("nobody", { exploreOptions: false }, db)).toBe(false);
  });
});
