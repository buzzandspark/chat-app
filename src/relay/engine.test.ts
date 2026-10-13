import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generations, messages, spendBuckets, usageEvents, users } from "@db/schema";
import { uuidv7 } from "@shared/id";
import type { Db } from "@db/client";
import { Budgets } from "./budgets";
import { BusyError, Engine, ForbiddenError, MissingUserMessageError, type ReplyDoneInfo, type StartInput } from "./engine";
import { ProviderStatusError } from "./providers/replay";
import { ScriptedProvider } from "./providers/scripted";
import type { Provider, ProviderRequest, ProviderStreamOptions } from "./providers/types";
import { TpsStats } from "./tps";
import { BudgetExceededError, QuotaExceededError, QuotaManager } from "./quota";
import { scenarioScript, type ScenarioName } from "./scenarios";
import { EventStore } from "./store";
import { collectUntilTerminal, createTestDb, seedUser, waitFor } from "./test-utils";

let db: Db;
let store: EventStore;
let engine: Engine;
const USER = "u1";

function makeEngine(speed: number, extra: Partial<ConstructorParameters<typeof Engine>[0]> = {}) {
  const scripted = new ScriptedProvider((req) => scenarioScript((req.scenario as ScenarioName) ?? "normal", req), speed);
  // Scripts stand in for the live provider here, so the billing paths under test are the real ones.
  const asLive = { name: "anthropic" as const, stream: scripted.stream.bind(scripted) };
  return new Engine({ db, store, providers: () => asLive, partialPersistMs: 50, ...extra });
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

  it("writes the covered seq with each partial so a resume never duplicates text", async () => {
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

  it("a scripted run costs nothing, teaches the estimator nothing, and is never refused by the cap", async () => {
    const scripted = new ScriptedProvider((req) => scenarioScript((req.scenario as ScenarioName) ?? "normal", req), 0);
    const tps = new TpsStats();
    const before = tps.get("claude-sonnet-5-5");
    engine = new Engine({ db, store, providers: () => scripted, partialPersistMs: 50, tps });
    db.update(users).set({ costCapUsd: 0.000001, costSpentUsd: 0 }).where(eq(users.id, USER)).run();
    const inp = input({ scenario: "normal" });
    expect(engine.start(inp)).toEqual({ created: true });
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events[events.length - 1]!.type).toBe("done");
    const usage = db.select().from(usageEvents).where(eq(usageEvents.generationId, inp.generationId)).all();
    expect(usage).toHaveLength(1);
    expect(usage[0]!.costUsd).toBe(0);
    expect(usage[0]!.outputTokens).toBeGreaterThan(0);
    expect(db.select().from(users).where(eq(users.id, USER)).get()!.costSpentUsd).toBe(0);
    expect(tps.get("claude-sonnet-5-5")).toBe(before);
    const gen = db.select().from(generations).where(eq(generations.id, inp.generationId)).get()!;
    expect(gen.provider).toBe("scripted");
  });

  it("a retry with no scenario of its own keeps the replaced reply's scenario (never a live prompt)", async () => {
    const providers: string[] = [];
    const scripted = new ScriptedProvider((req) => scenarioScript((req.scenario as ScenarioName) ?? "normal", req), 0);
    engine = new Engine({
      db,
      store,
      providers: (ctx) => {
        providers.push(ctx.scenario ?? "live");
        return scripted;
      },
      partialPersistMs: 50,
    });
    const first = input({ scenario: "max_tokens" });
    engine.start(first);
    await collectUntilTerminal(store, first.generationId);
    const retry = input({ chatId: first.chatId, userMessageId: first.userMessageId, text: undefined, scenario: undefined });
    engine.start(retry);
    const events = await collectUntilTerminal(store, retry.generationId);
    const started = events[0]!;
    expect(started.type === "started" && started.scenario).toBe("max_tokens");
    expect(providers.filter((p) => p === "live")).toHaveLength(0);
    const gen = db.select().from(generations).where(eq(generations.id, retry.generationId)).get()!;
    expect(gen.scenario).toBe("max_tokens");
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
    const spentBefore = db.select().from(users).where(eq(users.id, USER)).get()!.costSpentUsd;
    const outcome = engine.resume(inp.generationId, USER);
    if (outcome.kind !== "snapshot" || outcome.event.type !== "snapshot") throw new Error("expected snapshot");
    expect(outcome.event.status).toBe("interrupted");
    expect(db.select().from(generations).where(eq(generations.id, inp.generationId)).get()!.interruptedReason).toBe("crash");
    // A live run's orphan is charged its estimate from the saved text.
    const orphanRow = db.select().from(usageEvents).where(eq(usageEvents.generationId, inp.generationId)).all().find((u) => u.estimated)!;
    expect(orphanRow.costUsd).toBeGreaterThan(0);
    expect(db.select().from(users).where(eq(users.id, USER)).get()!.costSpentUsd).toBeCloseTo(spentBefore + orphanRow.costUsd, 10);
    expect(engine.resume(uuidv7(), USER)).toEqual({ kind: "not_found" });
  });

  it.each(["scripted", "replay"])("resume: a restarted %s run settles at zero cost and leaves spend alone", async (provider) => {
    const inp = input();
    engine.start(inp);
    await collectUntilTerminal(store, inp.generationId);
    // The same restart as above, but the column says the run came from a free provider.
    db.update(generations).set({ status: "running", provider }).where(eq(generations.id, inp.generationId)).run();
    db.update(messages).set({ status: "streaming" }).where(eq(messages.id, inp.assistantMessageId)).run();
    store.evict(inp.generationId);
    const spentBefore = db.select().from(users).where(eq(users.id, USER)).get()!.costSpentUsd;
    const outcome = engine.resume(inp.generationId, USER);
    if (outcome.kind !== "snapshot" || outcome.event.type !== "snapshot") throw new Error("expected snapshot");
    expect(outcome.event.status).toBe("interrupted");
    expect(db.select().from(generations).where(eq(generations.id, inp.generationId)).get()!.interruptedReason).toBe("crash");
    const orphanRow = db.select().from(usageEvents).where(eq(usageEvents.generationId, inp.generationId)).all().find((u) => u.estimated)!;
    expect(orphanRow.outputTokens).toBeGreaterThan(0);
    expect(orphanRow.costUsd).toBe(0);
    expect(db.select().from(users).where(eq(users.id, USER)).get()!.costSpentUsd).toBe(spentBefore);
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

  it("refuses a retry whose user message the chat does not have with MissingUserMessageError", () => {
    expect(() => makeEngine(0).start(input({ text: undefined }))).toThrow(MissingUserMessageError);
    expect(db.select().from(messages).all()).toEqual([]);
  });

  it("refuses to send into another user's chat with ForbiddenError and writes nothing", async () => {
    seedUser(db, "u2");
    const theirs = input({ userId: "u2" });
    engine.start(theirs);
    await collectUntilTerminal(store, theirs.generationId);
    const rows = () => ({ messages: db.select().from(messages).all(), generations: db.select().from(generations).all(), usage: db.select().from(usageEvents).all() });
    const before = rows();
    const mine = input({ chatId: theirs.chatId });
    expect(() => engine.start(mine)).toThrow(ForbiddenError);
    expect(rows()).toEqual(before);
    expect(store.has(mine.generationId)).toBe(false);
    expect(engine.runningCount()).toBe(0);
  });

  it("stops every running reply of a user once spend reaches the cap, keeping the text so far", async () => {
    // A reply is metered only when its user has a cap at the start. The two inputs alone ($0.0016 each) pass
    // $0.003, so the cap drops to that only once both replies have text.
    db.update(users).set({ costCapUsd: 1 }).where(eq(users.id, USER)).run();
    const slow = makeEngine(1);
    const a = input({ scenario: "long_reply" });
    const b = input({ scenario: "long_reply" });
    slow.start(a);
    slow.start(b);
    const hasText = (id: string) => store.get(id)?.events.some((e) => e.type === "text_delta") ?? false;
    await waitFor(() => hasText(a.generationId) && hasText(b.generationId));
    db.update(users).set({ costCapUsd: 0.003 }).where(eq(users.id, USER)).run();
    const ended = await Promise.all([a, b].map((inp) => collectUntilTerminal(store, inp.generationId)));
    for (const [i, inp] of [a, b].entries()) {
      const events = ended[i]!;
      expect(events.at(-1)).toMatchObject({ type: "error", error: { kind: "quota_exceeded", retryable: false } });
      const row = db.select().from(messages).where(eq(messages.id, inp.assistantMessageId)).get();
      expect(row?.status).toBe("error");
      expect(row?.content.some((b) => b.type === "text" && b.text.length > 0)).toBe(true);
    }
    // The settled spend sits at the cap, give or take the last delta of each stream.
    expect(db.select({ spent: users.costSpentUsd }).from(users).where(eq(users.id, USER)).get()?.spent).toBeLessThan(0.006);
  });

  it("admits on the UTF-8 size of the prompt's text and thinking, leaving out the turns a replace drops, then meters from message_start", async () => {
    const quota = new QuotaManager(db);
    const admit = vi.spyOn(quota, "admit");
    const started = vi.spyOn(quota, "started");
    engine = makeEngine(0, { quota });
    // Three bytes a character.
    const first = input({ text: "字".repeat(250) });
    engine.start(first);
    await collectUntilTerminal(store, first.generationId);
    expect(admit).toHaveBeenLastCalledWith(USER, first.generationId, "claude-sonnet-5-5", 750);
    expect(started).toHaveBeenCalledWith(first.generationId, "claude-sonnet-5-5", expect.objectContaining({ inputTokens: 800 }));
    const reply = db.select().from(messages).where(eq(messages.id, first.assistantMessageId)).get()!;
    const replyBytes = reply.content.reduce((n, b) => n + (b.type === "text" ? Buffer.byteLength(b.text) : b.type === "thinking" ? Buffer.byteLength(b.thinking) : 0), 0);
    expect(reply.content.some((b) => b.type === "thinking")).toBe(true);

    const next = input({ chatId: first.chatId, text: "y".repeat(250) });
    engine.start(next);
    await collectUntilTerminal(store, next.generationId);
    expect(admit).toHaveBeenLastCalledWith(USER, next.generationId, "claude-sonnet-5-5", 750 + 250 + replyBytes);

    const regenerate = input({ chatId: first.chatId, userMessageId: next.userMessageId, text: undefined, replaceFromMessageId: next.assistantMessageId });
    engine.start(regenerate);
    await collectUntilTerminal(store, regenerate.generationId);
    expect(admit).toHaveBeenLastCalledWith(USER, regenerate.generationId, "claude-sonnet-5-5", 750 + 250 + replyBytes);
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

  it("replaceFromMessageId drops the replaced turns in the same transaction and keeps their usage rows (#21, #73)", async () => {
    const first = input();
    engine.start(first);
    await collectUntilTerminal(store, first.generationId);
    const usageBefore = db.select().from(usageEvents).where(eq(usageEvents.userId, USER)).all();
    expect(usageBefore.length).toBeGreaterThan(0);
    // Regenerate: same user message, a new reply, replacing the old one.
    const again = input({ chatId: first.chatId, userMessageId: first.userMessageId, text: undefined, replaceFromMessageId: first.assistantMessageId });
    expect(engine.start(again)).toEqual({ created: true });
    await collectUntilTerminal(store, again.generationId);
    const rows = db.select({ id: messages.id, role: messages.role }).from(messages).where(eq(messages.chatId, first.chatId)).all();
    expect(rows.map((r) => r.id)).toEqual([first.userMessageId, again.assistantMessageId]);
    expect(db.select().from(generations).where(eq(generations.id, first.generationId)).get()).toBeUndefined();
    const usageAfter = db.select().from(usageEvents).where(eq(usageEvents.userId, USER)).all();
    expect(usageAfter.length).toBe(usageBefore.length * 2);
    expect(usageAfter.filter((u) => u.generationId === null).length).toBe(usageBefore.length);
  });

  it("a replaced edit removes the old user message too and a failed start removes nothing", async () => {
    const first = input();
    engine.start(first);
    await collectUntilTerminal(store, first.generationId);
    // The engine is draining: the start throws before its transaction, so the old turns must survive.
    const draining = makeEngine(0, { isDraining: () => true });
    expect(() => draining.start(input({ chatId: first.chatId, text: "edited", replaceFromMessageId: first.userMessageId }))).toThrow();
    expect(db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, first.chatId)).all()).toHaveLength(2);
    const edited = input({ chatId: first.chatId, text: "edited", replaceFromMessageId: first.userMessageId });
    expect(engine.start(edited)).toEqual({ created: true });
    await collectUntilTerminal(store, edited.generationId);
    const rows = db.select({ id: messages.id, content: messages.content }).from(messages).where(eq(messages.chatId, first.chatId)).all();
    expect(rows.map((r) => r.id)).toEqual([edited.userMessageId, edited.assistantMessageId]);
  });
});

/** A live-looking provider that fails the first `failures` requests before any event, then streams the normal script. */
function failingThen(failures: number, status = 500): { provider: Provider; calls: () => number } {
  let left = failures;
  let calls = 0;
  const scripted = new ScriptedProvider((req) => scenarioScript("normal", req), 0);
  const provider: Provider = {
    name: "anthropic",
    async *stream(req: ProviderRequest, opts: ProviderStreamOptions) {
      calls++;
      if (left-- > 0) throw new ProviderStatusError(status, "api_error", "boom");
      yield* scripted.stream(req, opts);
    },
  };
  return { provider, calls: () => calls };
}

describe("Engine: gate, retry and afterDone (forks)", () => {
  it("awaits the gate before the upstream request while the buffer already holds `started`", async () => {
    const live = failingThen(0);
    engine = new Engine({ db, store, providers: () => live.provider, partialPersistMs: 50 });
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const inp = input({ gate });
    engine.start(inp);
    await new Promise((r) => setTimeout(r, 20));
    expect(store.get(inp.generationId)!.events.map((e) => e.type)).toEqual(["started"]);
    expect(live.calls()).toBe(0);
    open();
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events.at(-1)!.type).toBe("done");
    expect(live.calls()).toBe(1);
  });

  it("retries a request that fails before the API begins a message, then gives up after the attempts", async () => {
    const twice = failingThen(2);
    engine = new Engine({ db, store, providers: () => twice.provider, partialPersistMs: 50 });
    const inp = input({ retry: { attempts: 3, baseMs: 1 } });
    engine.start(inp);
    const events = await collectUntilTerminal(store, inp.generationId);
    expect(events.at(-1)!.type).toBe("done");
    expect(twice.calls()).toBe(3);

    const always = failingThen(99);
    engine = new Engine({ db, store, providers: () => always.provider, partialPersistMs: 50 });
    const failed = input({ retry: { attempts: 3, baseMs: 1 } });
    engine.start(failed);
    const end = await collectUntilTerminal(store, failed.generationId);
    expect(end.at(-1)!.type).toBe("error");
    expect(always.calls()).toBe(4);
    expect(db.select().from(messages).where(eq(messages.id, failed.assistantMessageId)).get()!.status).toBe("error");
  });

  it("does not retry a failure that is not retryable, nor one after the API began a message", async () => {
    const bad = failingThen(1, 400);
    engine = new Engine({ db, store, providers: () => bad.provider, partialPersistMs: 50 });
    const inp = input({ retry: { attempts: 3, baseMs: 1 } });
    engine.start(inp);
    expect((await collectUntilTerminal(store, inp.generationId)).at(-1)!.type).toBe("error");
    expect(bad.calls()).toBe(1);

    let calls = 0;
    const midStream = new ScriptedProvider(
      { model: "claude-sonnet-5-5", parts: [{ kind: "text", text: "partial" }, { kind: "error", error: { type: "api_error", message: "x" } }] },
      0,
    );
    const counting: Provider = {
      name: "anthropic",
      stream(req, opts) {
        calls++;
        return midStream.stream(req, opts);
      },
    };
    engine = new Engine({ db, store, providers: () => counting, partialPersistMs: 50 });
    const later = input({ retry: { attempts: 3, baseMs: 1 } });
    engine.start(later);
    const events = await collectUntilTerminal(store, later.generationId);
    expect(events.at(-1)!.type).toBe("error");
    expect(calls).toBe(1);
  });

  it("afterDone fires once for a done reply with its text, and not for a refusal", async () => {
    const seen: ReplyDoneInfo[] = [];
    engine = makeEngine(0, { afterDone: (info) => seen.push(info) });
    const inp = input();
    engine.start(inp);
    await collectUntilTerminal(store, inp.generationId);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ chatId: inp.chatId, messageId: inp.assistantMessageId, generationId: inp.generationId, userId: USER, scenario: "normal", billable: true });
    expect(seen[0]!.text.length).toBeGreaterThan(0);

    const refused = input({ scenario: "refusal_empty" });
    engine.start(refused);
    await collectUntilTerminal(store, refused.generationId);
    expect(seen).toHaveLength(1);
  });
});

describe("Engine: guest budgets", () => {
  it("charges each way a guest's reply can end to its address and every guest's budget", async () => {
    seedUser(db, "g1", { role: "guest", costCapUsd: 1, budgetKeys: ["ip:203.0.113.7"] });
    const quota = new QuotaManager(db, { maxPromptTokens: 60_000, budgets: new Budgets(db, { ip: 100, ip48: 100, all: 100 }, () => 0) });
    const fast = makeEngine(0, { quota });
    const slow = makeEngine(1, { quota });
    const endingWith = (last: { kind: "disconnect" } | { kind: "error"; error: { type: string; message: string } }) => {
      const scripted = new ScriptedProvider({ model: "claude-haiku-5-5", parts: [{ kind: "text", text: "partial" }, last] }, 0);
      return new Engine({ db, store, quota, providers: () => ({ name: "anthropic", stream: scripted.stream.bind(scripted) }) });
    };
    const guest = (scenario: ScenarioName) => input({ userId: "g1", userRole: "guest", model: "claude-haiku-5-5", scenario });
    const spent = () => db.select().from(users).where(eq(users.id, "g1")).get()!.costSpentUsd;
    const levels = () => db.select().from(spendBuckets).all().map((b) => b.levelUsd);
    const runOn = async (on: Engine, scenario: ScenarioName) => {
      const inp = guest(scenario);
      on.start(inp);
      return { inp, end: (await collectUntilTerminal(store, inp.generationId)).at(-1) };
    };

    const endings: Record<string, () => Promise<unknown>> = {
      done: async () => expect((await runOn(fast, "normal")).end).toMatchObject({ type: "done" }),
      stopped: async () => {
        const inp = guest("slow_tokens");
        slow.start(inp);
        await waitFor(() => store.get(inp.generationId)?.events.some((e) => e.type === "text_delta") ?? false);
        await slow.stopAndWait(inp.generationId);
        expect(store.get(inp.generationId)!.events.at(-1)).toMatchObject({ type: "stopped" });
      },
      interrupted: async () => expect((await runOn(endingWith({ kind: "disconnect" }), "normal")).end).toMatchObject({ type: "interrupted" }),
      error: async () =>
        expect((await runOn(endingWith({ kind: "error", error: { type: "api_error", message: "x" } }), "normal")).end).toMatchObject({ type: "error" }),
      crash: async () => {
        const { inp } = await runOn(fast, "normal");
        db.update(generations).set({ status: "running" }).where(eq(generations.id, inp.generationId)).run();
        store.evict(inp.generationId);
        const before = spent();
        fast.resume(inp.generationId, "g1");
        expect(spent()).toBeGreaterThan(before);
      },
    };
    for (const [ending, run] of Object.entries(endings)) {
      const before = spent();
      await run();
      expect(spent(), ending).toBeGreaterThan(before);
      const [ip, all] = levels();
      expect(ip, ending).toBeCloseTo(spent(), 12);
      expect(all, ending).toBeCloseTo(spent(), 12);
    }
    // A reply whose worst case does not fit under the cap never starts.
    db.update(users).set({ costCapUsd: spent() + 0.001 }).where(eq(users.id, "g1")).run();
    expect(() => fast.start(guest("normal"))).toThrow(QuotaExceededError);
  });
});

describe("Engine: guest prompts", () => {
  const guestInput = (text: string) => input({ userId: "g1", userRole: "guest", model: "claude-haiku-5-5", text });
  let quota: QuotaManager;
  let streamed: ProviderRequest[];
  let counted: number;

  beforeEach(() => {
    seedUser(db, "g1", { role: "guest", costCapUsd: 1, budgetKeys: ["ip:203.0.113.7"] });
    quota = new QuotaManager(db, { maxPromptTokens: 60_000, budgets: new Budgets(db, { ip: 1, ip48: 3, all: 10 }, () => 0) });
    streamed = [];
    const scripted = new ScriptedProvider((req) => scenarioScript("normal", req), 0);
    const live: Provider = {
      name: "anthropic",
      stream(req, opts) {
        streamed.push(req);
        return scripted.stream(req, opts);
      },
      countTokens: async () => counted,
    };
    engine = new Engine({ db, store, quota, providers: () => live });
  });

  const send = async (text: string) => {
    const inp = guestInput(text);
    engine.start(inp);
    return (await collectUntilTerminal(store, inp.generationId)).at(-1);
  };

  it("counts a guest's prompt before sending it, refuses one over the limit unsent, and cuts off the address of a dense payload", async () => {
    counted = 60_001;
    expect(await send("A long conversation in plain words. ".repeat(6_000))).toMatchObject({ type: "error", error: { kind: "context_full" } });
    expect(db.select().from(spendBuckets).all()).toEqual([]);
    counted = 66_000;
    expect(await send("x".repeat(70_000))).toMatchObject({ type: "error", error: { kind: "context_full" } });
    expect(streamed).toHaveLength(0);
    expect(db.select().from(users).where(eq(users.id, "g1")).get()!.costSpentUsd).toBe(0);
    counted = 100;
    expect(() => engine.start(guestInput("hello"))).toThrow(BudgetExceededError);
  });

  it("keeps nothing of a guest send refused as too long, while its buffer still serves the refusal", async () => {
    counted = 100;
    const first = guestInput("hello");
    engine.start(first);
    expect((await collectUntilTerminal(store, first.generationId)).at(-1)).toMatchObject({ type: "done" });
    const kept = { messages: db.select().from(messages).all(), generations: db.select().from(generations).all() };
    counted = 60_001;
    const refused = input({ userId: "g1", userRole: "guest", model: "claude-haiku-5-5", chatId: first.chatId, text: "A long conversation in plain words. ".repeat(6_000) });
    engine.start(refused);
    expect((await collectUntilTerminal(store, refused.generationId)).at(-1)).toMatchObject({ type: "error", error: { kind: "context_full" } });
    expect({ messages: db.select().from(messages).all(), generations: db.select().from(generations).all() }).toEqual(kept);
    expect(db.select().from(usageEvents).where(eq(usageEvents.generationId, refused.generationId)).all()).toEqual([]);
    expect(engine.owner(refused.generationId)).toBe("g1");
    expect(engine.resume(refused.generationId, "g1")).toEqual({ kind: "live" });
    expect(() => engine.resume(refused.generationId, USER)).toThrow(ForbiddenError);
  });

  it("stops a guest reply whose message_start bills a prompt over the limit, charging what it billed", async () => {
    quota = new QuotaManager(db, { maxPromptTokens: 500, budgets: new Budgets(db, { ip: 1, ip48: 3, all: 10 }, () => 0) });
    engine = new Engine({ db, store, quota, providers: () => ({ name: "anthropic", stream: (req, opts) => new ScriptedProvider(scenarioScript("normal", req), 0).stream(req, opts), countTokens: async () => 100 }) });
    // The scripted message_start bills 800 input tokens.
    expect(await send("hello")).toMatchObject({ type: "error", error: { kind: "context_full" } });
    expect(db.select().from(users).where(eq(users.id, "g1")).get()!.costSpentUsd).toBeGreaterThan(0);
  });

  it("counts only a prompt whose byte bound is over the limit, and refuses it retryably when the count fails or stalls", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    let count: (signal: AbortSignal) => Promise<number> = () => Promise.reject(new Error("overloaded"));
    const scripted = new ScriptedProvider((req) => scenarioScript("normal", req), 0);
    engine = new Engine({
      db,
      store,
      quota,
      countTimeoutMs: 50,
      providers: () => ({ name: "anthropic", stream: (req, opts) => (streamed.push(req), scripted.stream(req, opts)), countTokens: (_req, opts) => count(opts.signal) }),
    });
    expect(await send("hello")).toMatchObject({ type: "done" });
    const retry = { type: "error", error: { kind: "overloaded", retryable: true } };
    expect(await send("x".repeat(60_000))).toMatchObject(retry);
    count = (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason)));
    expect(await send("x".repeat(60_000))).toMatchObject(retry);
    expect(streamed).toHaveLength(1);
    // A retry replaces from the refused reply, so its rows stay.
    expect(db.select().from(generations).all().map((g) => g.status)).toEqual(["done", "error", "error"]);
    quiet.mockRestore();
  });
});

describe("Engine: guests' running replies", () => {
  const guest = (userId: string, overrides: Partial<StartInput> = {}) =>
    input({ userId, userRole: "guest", model: "claude-haiku-5-5", scenario: "slow_tokens", ...overrides });

  beforeEach(() => {
    for (const id of ["g1", "g2", "g3"]) seedUser(db, id, { role: "guest", costCapUsd: 1 });
  });

  it("runs two live replies at once per guest, a fork taking half of one and waiting for it, each asking for at most 8192 tokens", async () => {
    const requests: ProviderRequest[] = [];
    const slow = new ScriptedProvider((req) => scenarioScript("slow_tokens", req), 1);
    const free = new ScriptedProvider((req) => scenarioScript("slow_tokens", req), 1);
    const live: Provider = {
      name: "anthropic",
      stream(req, opts) {
        requests.push(req);
        return slow.stream(req, opts);
      },
    };
    engine = new Engine({ db, store, providers: (ctx) => (ctx.scenario === "normal" ? free : live), partialPersistMs: 50 });
    const first = guest("g1");
    engine.start(first);
    engine.start(guest("g1", { fanOut: true }));
    engine.start(guest("g1", { fanOut: true }));
    expect(() => engine.start(guest("g1"))).toThrow(BusyError);
    // A third fork waits for a slot instead.
    expect(engine.start(guest("g1", { fanOut: true }))).toEqual({ created: true });
    // Another guest, an invited user and a scripted run are not held back.
    expect(engine.start(guest("g2"))).toEqual({ created: true });
    expect(engine.start(input({ scenario: "slow_tokens" }))).toEqual({ created: true });
    expect(engine.start(guest("g1", { scenario: "normal" }))).toEqual({ created: true });
    await waitFor(() => requests.length === 5);
    expect(requests.filter((r) => r.userId === "g1")).toHaveLength(3);
    await engine.stopAndWait(first.generationId);
    await waitFor(() => requests.length === 6);
    expect(requests.map((r) => [r.userId, r.maxTokens])).toEqual(expect.arrayContaining([["g1", 8192], ["g2", 8192], [USER, undefined]]));
    expect(requests.filter((r) => r.userId !== USER).every((r) => r.maxTokens === 8192)).toBe(true);
    await engine.drain();
  });

  it("ends a fork stopped while it waits for a slot without sending it", async () => {
    const requests: ProviderRequest[] = [];
    const slow = new ScriptedProvider((req) => scenarioScript("slow_tokens", req), 1);
    engine = new Engine({ db, store, providers: () => ({ name: "anthropic", stream: (req, opts) => (requests.push(req), slow.stream(req, opts)) }), guestRunning: { perGuest: 1, total: 10 } });
    engine.start(guest("g1"));
    const waiting = guest("g1", { fanOut: true });
    engine.start(waiting);
    engine.stop(waiting.generationId);
    expect((await collectUntilTerminal(store, waiting.generationId)).at(-1)).toMatchObject({ type: "stopped" });
    expect(requests).toHaveLength(1);
    await engine.drain();
  });

  it("holds a waiting fork's worst case against the cap only once it has a slot", async () => {
    // Each fork's worst case is about $0.0046: two fit under the cap, three do not.
    db.update(users).set({ costCapUsd: 0.01 }).where(eq(users.id, "g1")).run();
    const quota = new QuotaManager(db, { maxPromptTokens: 60_000, budgets: new Budgets(db, { ip: 100, ip48: 100, all: 100 }, () => 0) });
    const scripted = new ScriptedProvider((req) => scenarioScript("normal", req), 1);
    engine = new Engine({ db, store, quota, providers: () => ({ name: "anthropic", stream: scripted.stream.bind(scripted) }), guestRunning: { perGuest: 1, total: 10 } });
    const forks = [1, 2, 3].map(() => guest("g1", { fanOut: true, scenario: "normal" }));
    for (const fork of forks) expect(engine.start(fork)).toEqual({ created: true });
    for (const fork of forks) expect((await collectUntilTerminal(store, fork.generationId)).at(-1)).toMatchObject({ type: "done" });
  });

  it("holds all guests together to the total", async () => {
    engine = makeEngine(1, { guestRunning: { perGuest: 2, total: 3 } });
    engine.start(guest("g1"));
    engine.start(guest("g1"));
    engine.start(guest("g2"));
    expect(() => engine.start(guest("g3"))).toThrow(BusyError);
    expect(engine.start(input({ scenario: "slow_tokens" }))).toEqual({ created: true });
    await engine.drain();
  });
});

describe("Engine: stopped and interrupted estimates", () => {
  class FixedTps extends TpsStats {
    constructor(private rate: number) {
      super();
    }
    override get(): number {
      return this.rate;
    }
  }
  // Streams `parts` in real time, then goes silent.
  const stalling = (model: string, parts: { kind: "text"; text: string; chunk: number; intervalMs: number }[] = []): Provider => {
    const scripted = new ScriptedProvider({ model, ttftMs: 0, parts: [...parts, { kind: "pause", ms: 60_000 }, { kind: "text", text: "never" }] }, 1);
    return { name: "anthropic", stream: scripted.stream.bind(scripted) };
  };
  const outputTokens = (generationId: string) => db.select().from(usageEvents).where(eq(usageEvents.generationId, generationId)).get()!.outputTokens;

  it("ends a silent upstream's estimate at its last event, not when the silence is noticed", async () => {
    engine = new Engine({ db, store, providers: () => stalling("claude-sonnet-5-5", [{ kind: "text", text: "hi", chunk: 2, intervalMs: 0 }]), tps: new FixedTps(1000), upstreamIdleMs: 300 });
    const inp = input();
    engine.start(inp);
    expect((await collectUntilTerminal(store, inp.generationId)).at(-1)).toMatchObject({ type: "interrupted", reason: "upstream" });
    // 300 ms of silence would be 300 tokens.
    expect(outputTokens(inp.generationId)).toBeLessThan(50);
  });

  it("estimates a stop from message_start, never counting the wait before the request", async () => {
    engine = new Engine({ db, store, providers: () => stalling("claude-opus-5-5"), tps: new FixedTps(1000) });
    const inp = input({ model: "claude-opus-5-5", gate: new Promise((resolve) => setTimeout(resolve, 300)) });
    engine.start(inp);
    await waitFor(() => store.get(inp.generationId)?.events.some((e) => e.type === "message_start") ?? false);
    await engine.stopAndWait(inp.generationId);
    expect(store.get(inp.generationId)!.events.at(-1)).toMatchObject({ type: "stopped" });
    expect(outputTokens(inp.generationId)).toBeLessThan(50);
  });

  it("settles a guest reply cut off by a crash at no more than max_tokens of output", async () => {
    seedUser(db, "g1", { role: "guest", costCapUsd: 1, budgetKeys: ["ip:g1"] });
    const quota = new QuotaManager(db, { maxPromptTokens: 60_000, budgets: new Budgets(db, { ip: 100, ip48: 100, all: 100 }, () => 0) });
    engine = makeEngine(0, { quota });
    const inp = input({ userId: "g1", userRole: "guest", model: "claude-haiku-5-5" });
    engine.start(inp);
    await collectUntilTerminal(store, inp.generationId);
    db.update(generations).set({ status: "running" }).where(eq(generations.id, inp.generationId)).run();
    db.update(messages).set({ content: [{ type: "text", text: "word ".repeat(20_000), citations: null }] }).where(eq(messages.id, inp.assistantMessageId)).run();
    store.evict(inp.generationId);
    engine.resume(inp.generationId, "g1");
    const crash = db.select().from(usageEvents).where(eq(usageEvents.generationId, inp.generationId)).all().find((u) => u.estimated);
    expect(crash?.outputTokens).toBe(8192);
  });

  it("settles a guest reply cut off after streaming within its hold, so within the cap, however long it streamed or stalled", async () => {
    // "hello" holds 4101 prompt tokens at $0.125 / M plus 8192 output tokens at $0.50 / M: about $0.0046.
    const cap = 0.0047;
    for (const id of ["g1", "g2"]) seedUser(db, id, { role: "guest", costCapUsd: cap, budgetKeys: [`ip:${id}`] });
    const quota = new QuotaManager(db, { maxPromptTokens: 60_000, budgets: new Budgets(db, { ip: 100, ip48: 100, all: 100 }, () => 0) });
    // At this rate 100 ms of streaming is 10,000 tokens, past max_tokens.
    const text = [{ kind: "text" as const, text: "x".repeat(30), chunk: 1, intervalMs: 10 }];
    engine = new Engine({ db, store, quota, providers: () => stalling("claude-haiku-5-5", text), tps: new FixedTps(100_000), upstreamIdleMs: 200 });
    const guest = (userId: string) => input({ userId, userRole: "guest", model: "claude-haiku-5-5", scenario: undefined });

    const idle = guest("g1");
    engine.start(idle);
    expect((await collectUntilTerminal(store, idle.generationId)).at(-1)).toMatchObject({ type: "interrupted" });
    const stopped = guest("g2");
    engine.start(stopped);
    await waitFor(() => (store.get(stopped.generationId)?.events.filter((e) => e.type === "text_delta").length ?? 0) >= 15);
    await engine.stopAndWait(stopped.generationId);

    for (const [inp, id] of [[idle, "g1"], [stopped, "g2"]] as const) {
      expect(outputTokens(inp.generationId)).toBe(8192);
      const spent = db.select().from(users).where(eq(users.id, id)).get()!.costSpentUsd;
      expect(spent).toBeGreaterThan(0);
      expect(spent).toBeLessThanOrEqual(cap);
    }
  });
});
