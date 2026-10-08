import { beforeEach, describe, expect, it } from "vitest";
import { uuidv7 } from "@shared/id";
import type { Db } from "@db/client";
import { admissionRefusal, MAX_RUNNING_PER_USER, startAdmitted } from "./admission";
import { Engine, type StartInput } from "./engine";
import { ScriptedProvider } from "./providers/scripted";
import { RateLimiter } from "./ratelimit";
import { scenarioScript, type ScenarioName } from "./scenarios";
import { EventStore } from "./store";
import { createTestDb, seedUser, waitFor } from "./test-utils";

let db: Db;
let store: EventStore;
let engine: Engine;
const USER = "u1";

function input(overrides: Partial<StartInput> = {}): StartInput {
  return {
    generationId: uuidv7(),
    chatId: uuidv7(),
    userId: USER,
    userRole: "user",
    userMessageId: uuidv7(),
    assistantMessageId: uuidv7(),
    text: "hello",
    model: "claude-sonnet-5-5",
    thinking: { harder: false },
    scenario: "slow_tokens",
    ...overrides,
  };
}

beforeEach(() => {
  db = createTestDb();
  store = new EventStore();
  seedUser(db, USER);
  // Real-time slow_tokens: every generation stays running until it is stopped.
  const scripted = new ScriptedProvider((req) => scenarioScript((req.scenario as ScenarioName) ?? "normal", req), 1);
  engine = new Engine({ db, store, providers: () => scripted, partialPersistMs: 50 });
});

describe("startAdmitted", () => {
  it("parallel regenerates that wait on the same stop cannot start past the running cap", async () => {
    const victim = input();
    expect(startAdmitted(engine, new RateLimiter(), victim)).toEqual({ created: true });
    const limiter = new RateLimiter();
    // Each request passes the check made before the await: the victim is the only one running.
    const requests = Array.from({ length: 6 }, () => {
      const inp = input({ chatId: victim.chatId, userMessageId: victim.userMessageId, text: undefined, replaceFromMessageId: victim.assistantMessageId });
      expect(admissionRefusal(engine, limiter, USER)).toBeNull();
      return (async () => {
        await engine.stopAndWait(victim.generationId);
        return startAdmitted(engine, limiter, inp);
      })();
    });
    const outcomes = await Promise.all(requests);
    expect(outcomes.filter((o) => o.created)).toHaveLength(MAX_RUNNING_PER_USER);
    expect(outcomes.filter((o) => !o.created && o.reason === "rate_limited")).toHaveLength(6 - MAX_RUNNING_PER_USER);
    expect(engine.runningFor(USER)).toBe(MAX_RUNNING_PER_USER);
    await engine.drain();
  });

  it("parallel starts cannot pass the per-minute window, and only a created start is charged", async () => {
    const limiter = new RateLimiter(2, 300);
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, async () => {
        expect(admissionRefusal(engine, limiter, USER, 10)).toBeNull();
        await Promise.resolve();
        return startAdmitted(engine, limiter, input(), 10);
      }),
    );
    expect(outcomes.filter((o) => o.created)).toHaveLength(2);
    const refused = outcomes.find((o) => !o.created && o.reason === "rate_limited");
    expect(refused && "retryAfterMs" in refused && refused.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.check(USER, false).remainingMinute).toBe(0);
    await engine.drain();
  });

  it("never refuses an id that already exists: a duplicate POST attaches even at the cap", async () => {
    const limiter = new RateLimiter();
    const first = input();
    expect(startAdmitted(engine, limiter, first)).toEqual({ created: true });
    for (let i = 1; i < MAX_RUNNING_PER_USER; i++) startAdmitted(engine, limiter, input());
    await waitFor(() => engine.runningFor(USER) === MAX_RUNNING_PER_USER);
    expect(admissionRefusal(engine, limiter, USER)).not.toBeNull();
    expect(startAdmitted(engine, limiter, input())).toMatchObject({ created: false, reason: "rate_limited" });
    expect(startAdmitted(engine, limiter, first)).toEqual({ created: false, reason: "exists" });
    expect(limiter.check(USER, false).remainingMinute).toBe(20 - MAX_RUNNING_PER_USER);
    await engine.drain();
  });
});
