import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { generations, messages, usageEvents, users } from "@db/schema";
import { uuidv7 } from "@shared/id";
import type { Db } from "@db/client";
import { Engine, ForbiddenError, type StartInput } from "./engine";
import { ScriptedProvider } from "./providers/scripted";
import { QuotaExceededError } from "./quota";
import { scenarioScript, type ScenarioName } from "./scenarios";
import { EventStore } from "./store";
import { collectUntilTerminal, createTestDb, seedUser, waitFor } from "./test-utils";

let db: Db;
let store: EventStore;
let engine: Engine;
const USER = "u1";

function makeEngine(speed: number, extra: Partial<ConstructorParameters<typeof Engine>[0]> = {}) {
  const scripted = new ScriptedProvider((req) => scenarioScript((req.scenario as ScenarioName) ?? "normal", req), speed);
  return new Engine({ db, store, providers: () => scripted, partialPersistMs: 50, ...extra });
}

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
    scenario: "normal",
    ...overrides,
  };
}

beforeEach(() => {
  db = createTestDb();
  store = new EventStore();
  seedUser(db, USER);
  engine = makeEngine(0);
});

describe("Engine", () => {
  it("runs a generation to done, persists content, usage, and timings", async () => {
    const inp = input();
    expect(engine.start(inp)).toEqual({ created: true });
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events[0]!.type).toBe("started");
    expect(events[0]!.seq).toBe(0);
    const done = events[events.length - 1]!;
    expect(done.type).toBe("done");
    if (done.type !== "done") throw new Error("unreachable");
    expect(done.stopReason).toBe("end_turn");
    expect(done.servingModel).toBe("claude-sonnet-5-5");
    expect(done.usage.estimated).toBe(false);
    expect(done.timings.upstreamFirstToken).toBeDefined();
    expect(done.timings.firstRelayed).toBeDefined();

    const msg = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get()!;
    expect(msg.status).toBe("done");
    expect(msg.content.some((b) => b.type === "text")).toBe(true);
    expect(msg.content.some((b) => b.type === "thinking")).toBe(true);
    expect(msg.servingModel).toBe("claude-sonnet-5-5");
    const gen = db.select().from(generations).where(eq(generations.id, inp.generationId)).get()!;
    expect(gen.status).toBe("done");
    const usage = db.select().from(usageEvents).where(eq(usageEvents.generationId, inp.generationId)).all();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.estimated).toBe(false);
    const user = db.select().from(users).where(eq(users.id, USER)).get()!;
    expect(user.costSpentUsd).toBeGreaterThan(0);
    expect(engine.runningCount()).toBe(0);
  });

  it("writes the covered seq with each partial so a resume never duplicates text (D2)", async () => {
    engine = makeEngine(1);
    const inp = input({ scenario: "slow_tokens" });
    engine.start(inp);
    await waitFor(() => (store.get(inp.generationId)?.events.filter((e) => e.type === "text_delta").length ?? 0) >= 3, 5000);
    await waitFor(() => (db.select({ lastSeq: messages.lastSeq }).from(messages).where(eq(messages.id, inp.assistantMessageId)).get()?.lastSeq ?? null) !== null, 2000);
    const row = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get()!;
    const events = store.get(inp.generationId)!.events;
    const covered = events.slice(0, row.lastSeq! + 1);
    const expected = covered.filter((e) => e.type === "text_delta").map((e) => (e.type === "text_delta" ? e.text : "")).join("");
    const saved = row.content.filter((b) => b.type === "text").map((b) => (b.type === "text" ? b.text : "")).join("");
    expect(saved).toBe(expected);
    engine.stop(inp.generationId);
    await collectUntilTerminal(store, inp.generationId);
    const finalRow = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get()!;
    expect(finalRow.lastSeq).toBe(store.get(inp.generationId)!.events.length - 1);
  });

  it("ends a generation whose upstream goes silent as interrupted (upstream)", async () => {
    const silent = {
      name: "scripted" as const,
      stream(_req: unknown, { signal }: { signal: AbortSignal }) {
        return (async function* () {
          const script = scenarioScript("normal", { model: "claude-sonnet-5-5", thinking: { harder: false }, messages: [] });
          const { scriptToFixture } = await import("./providers/scripted");
          const lines = scriptToFixture(script);
          const first = lines.find((l) => "event" in l);
          if (first && "event" in first) yield first.event;
          await new Promise<void>((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
        })();
      },
    };
    engine = new Engine({ db, store, providers: () => silent as never, partialPersistMs: 50, upstreamIdleMs: 60 });
    const inp = input();
    engine.start(inp);
    const events = await collectUntilTerminal(store, inp.generationId, 5000);
    const last = events[events.length - 1]!;
    expect(last.type).toBe("interrupted");
    if (last.type === "interrupted") expect(last.reason).toBe("upstream");
    const row = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get()!;
    expect(row.status).toBe("interrupted");
    expect(engine.runningCount()).toBe(0);
  });

  it("is idempotent on generationId", async () => {
    const inp = input();
    expect(engine.start(inp)).toEqual({ created: true });
    expect(engine.start(inp)).toEqual({ created: false, reason: "exists" });
    await collectUntilTerminal(store, inp.generationId);
    expect(engine.start(inp)).toEqual({ created: false, reason: "exists" });
    expect(db.select().from(messages).where(eq(messages.chatId, inp.chatId)).all()).toHaveLength(2);
  });

  it("stops explicitly, persisting the partial with an estimated usage row", async () => {
    engine = makeEngine(1);
    const inp = input({ scenario: "slow_tokens" });
    engine.start(inp);
    await waitFor(() => (store.get(inp.generationId)?.events.some((e) => e.type === "text_delta") ?? false), 5000);
    expect(engine.stop(inp.generationId)).toBe(true);
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events[events.length - 1]!.type).toBe("stopped");
    const msg = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get()!;
    expect(msg.status).toBe("stopped");
    expect(msg.content.some((b) => b.type === "text")).toBe(true);
    const usage = db.select().from(usageEvents).where(eq(usageEvents.generationId, inp.generationId)).all();
    expect(usage[0]!.estimated).toBe(true);
    expect(engine.stop(inp.generationId)).toBe(false);
  });

  it("resume: live while buffered, done snapshot after eviction", async () => {
    const inp = input();
    engine.start(inp);
    expect(engine.resume(inp.generationId, USER)).toEqual({ kind: "live" });
    await collectUntilTerminal(store, inp.generationId);
    store.evict(inp.generationId);
    const outcome = engine.resume(inp.generationId, USER);
    expect(outcome.kind).toBe("snapshot");
    if (outcome.kind !== "snapshot") throw new Error("unreachable");
    expect(outcome.event.seq).toBeNull();
    expect(outcome.event.type).toBe("snapshot");
    if (outcome.event.type !== "snapshot") throw new Error("unreachable");
    expect(outcome.event.status).toBe("done");
    expect(outcome.event.message.content.length).toBeGreaterThan(0);
  });

  it("resume: a running row with no buffer means a restart; it becomes an interrupted snapshot", async () => {
    const inp = input();
    engine.start(inp);
    await collectUntilTerminal(store, inp.generationId);
    // Simulate a process restart that died mid-stream.
    db.update(generations).set({ status: "running" }).where(eq(generations.id, inp.generationId)).run();
    db.update(messages).set({ status: "streaming" }).where(eq(messages.id, inp.assistantMessageId)).run();
    store.evict(inp.generationId);
    const outcome = engine.resume(inp.generationId, USER);
    if (outcome.kind !== "snapshot" || outcome.event.type !== "snapshot") throw new Error("expected snapshot");
    expect(outcome.event.status).toBe("interrupted");
    expect(db.select().from(generations).where(eq(generations.id, inp.generationId)).get()!.interruptedReason).toBe("crash");
    expect(engine.resume(uuidv7(), USER)).toEqual({ kind: "not_found" });
  });

  it("refusal with partial text ends refused and is excluded from later history", async () => {
    const inp = input({ scenario: "refusal_partial" });
    engine.start(inp);
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events.find((e) => e.type === "refusal")).toMatchObject({ hadText: true, category: null });
    const done = events[events.length - 1]!;
    expect(done.type).toBe("done");
    const msg = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get()!;
    expect(msg.status).toBe("refused");
    expect(msg.stopReason).toBe("refusal");
  });

  it("pre-output fallback serves on the fallback model with two priced iterations", async () => {
    const inp = input({ scenario: "fallback_pre_output" });
    engine.start(inp);
    const events = await collectUntilTerminal(store, inp.generationId);
    const done = events[events.length - 1]!;
    if (done.type !== "done") throw new Error("expected done");
    expect(done.servingModel).toBe("claude-opus-4-8");
    expect(done.timings.declinedAttempt).toBe(true);
    const usage = db.select().from(usageEvents).where(eq(usageEvents.generationId, inp.generationId)).all();
    expect(usage.map((u) => u.model).sort()).toEqual(["claude-opus-4-8", "claude-sonnet-5-5"]);
    const msg = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get()!;
    expect(msg.content[0]!.type).toBe("fallback");
  });

  it("an upstream disconnect ends interrupted with reason upstream", async () => {
    const scripted = new ScriptedProvider({ model: "claude-sonnet-5-5", parts: [{ kind: "text", text: "some text" }, { kind: "disconnect" }] }, 0);
    engine = new Engine({ db, store, providers: () => scripted });
    const inp = input({ scenario: undefined });
    engine.start(inp);
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events[events.length - 1]).toMatchObject({ type: "interrupted", reason: "upstream" });
    const msg = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get()!;
    expect(msg.status).toBe("interrupted");
    expect(msg.content[0]).toMatchObject({ type: "text", text: "some text" });
  });

  it("maps a 429 before output to a rate_limited error with retry-after", async () => {
    const inp = input({ scenario: "rate_limited" });
    engine.start(inp);
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events[events.length - 1]).toMatchObject({ type: "error", error: { kind: "rate_limited", retryAfterMs: 20000 } });
    const msg = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get()!;
    expect(msg.status).toBe("error");
    expect(db.select().from(usageEvents).where(eq(usageEvents.generationId, inp.generationId)).all()).toHaveLength(0);
  });

  it("producer restart fault interrupts the generation, never the process", async () => {
    const inp = input({ scenario: "producer_restart", faults: { interruptAfterEvents: 10 } });
    engine.start(inp);
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events[events.length - 1]).toMatchObject({ type: "interrupted", reason: "crash" });
    expect(events.length).toBeLessThan(20);
  });

  it("drain marks running generations interrupted with reason shutdown", async () => {
    engine = makeEngine(1);
    const inp = input({ scenario: "slow_tokens" });
    engine.start(inp);
    await waitFor(() => (store.get(inp.generationId)?.events.some((e) => e.type === "message_start") ?? false));
    await engine.drain();
    const events = store.get(inp.generationId)!.events;
    expect(events[events.length - 1]).toMatchObject({ type: "interrupted", reason: "shutdown" });
    expect(db.select().from(generations).where(eq(generations.id, inp.generationId)).get()!.status).toBe("interrupted");
  });

  it("refuses to start while draining and over quota", () => {
    const draining = makeEngine(0, { isDraining: () => true });
    expect(() => draining.start(input())).toThrow(/restarting/);
    db.update(users).set({ costCapUsd: 0.000001 }).where(eq(users.id, USER)).run();
    expect(() => engine.start(input())).toThrow(QuotaExceededError);
  });

  it("builds history from earlier turns and keeps a retry's existing user message", async () => {
    const chatId = uuidv7();
    const first = input({ chatId, text: "first question" });
    engine.start(first);
    await collectUntilTerminal(store, first.generationId);
    const second = input({ chatId, text: "second question" });
    engine.start(second);
    await collectUntilTerminal(store, second.generationId);
    const rows = db.select().from(messages).where(eq(messages.chatId, chatId)).all();
    expect(rows.map((r) => r.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
    // Retry: same user message id, new assistant and generation, no text.
    const retry = input({ chatId, userMessageId: second.userMessageId, text: undefined });
    engine.start(retry);
    await collectUntilTerminal(store, retry.generationId);
    expect(db.select().from(messages).where(eq(messages.chatId, chatId)).all()).toHaveLength(5);
  });

  it("stopAndWait settles before the caller deletes rows; nothing leaks", async () => {
    engine = makeEngine(1);
    db.update(users).set({ costCapUsd: 1 }).where(eq(users.id, USER)).run();
    const inp = input({ scenario: "slow_tokens" });
    engine.start(inp);
    await waitFor(() => (store.get(inp.generationId)?.events.some((e) => e.type === "text_delta") ?? false), 5000);
    await engine.stopAndWait(inp.generationId);
    expect(store.get(inp.generationId)!.terminal).toBe(true);
    expect(engine.runningCount()).toBe(0);
    db.delete(generations).where(eq(generations.id, inp.generationId)).run();
    // The reservation was released: a capped user can start again.
    expect(engine.start(input({ scenario: "normal" }))).toEqual({ created: true });
  });

  it("rows deleted mid-stream still end with a terminal event, settled cost and no reservation", async () => {
    engine = makeEngine(1);
    db.update(users).set({ costCapUsd: 1 }).where(eq(users.id, USER)).run();
    const inp = input({ scenario: "slow_tokens" });
    engine.start(inp);
    await waitFor(() => (store.get(inp.generationId)?.events.some((e) => e.type === "text_delta") ?? false), 5000);
    // A chat delete cascades the generation and its messages away without stopping anything.
    db.delete(generations).where(eq(generations.id, inp.generationId)).run();
    db.delete(messages).where(eq(messages.chatId, inp.chatId)).run();
    engine.stop(inp.generationId);
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events[events.length - 1]!.type).toBe("stopped");
    expect(engine.runningCount()).toBe(0);
    expect(db.select().from(users).where(eq(users.id, USER)).get()!.costSpentUsd).toBeGreaterThan(0);
    expect(engine.start(input({ scenario: "normal" }))).toEqual({ created: true });
  });

  it("stopChat settles every running generation of a chat", async () => {
    engine = makeEngine(1);
    const inp = input({ scenario: "slow_tokens" });
    engine.start(inp);
    await waitFor(() => (store.get(inp.generationId)?.events.some((e) => e.type === "message_start") ?? false));
    await engine.stopChat(inp.chatId);
    expect(engine.runningCount()).toBe(0);
    expect(db.select().from(generations).where(eq(generations.id, inp.generationId)).get()!.status).toBe("stopped");
  });

  it("resume refuses another user's buffer while it is live", async () => {
    seedUser(db, "u2");
    engine = makeEngine(1);
    const inp = input({ scenario: "slow_tokens" });
    engine.start(inp);
    expect(() => engine.resume(inp.generationId, "u2")).toThrow(ForbiddenError);
    expect(engine.resume(inp.generationId, USER)).toEqual({ kind: "live" });
    await engine.stopAndWait(inp.generationId);
    expect(() => engine.resume(inp.generationId, "u2")).toThrow(ForbiddenError);
  });
});
