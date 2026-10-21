import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@db/client";
import { chats, generations, messages, spendBuckets, usageEvents, users } from "@db/schema";
import { MAX_FORKS, type ForkOption } from "@shared/forks";
import { uuidv7 } from "@shared/id";
import { Budgets } from "../budgets";
import { BusyError, type ReplyDoneInfo } from "../engine";
import { BudgetExceededError, QuotaManager } from "../quota";
import { costOf } from "../anthropic/pricing";
import { createTestDb, seedUser } from "../test-utils";
import { OPTIONS_MODEL, OptionsCallError, SCRIPTED_OPTIONS, type MessengerResult, type OptionsMessenger } from "./messenger";
import { OptionsService } from "./service";

const USER = "u1";
let db: Db;

const TWO: ForkOption[] = [
  { title: "Option A", prompt: "Explore A" },
  { title: "Option B", prompt: "Explore B" },
];
const USAGE = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };
const TRACE = { model: "claude-haiku-5-5", system: "s", user: "u", response: {}, stopReason: "end_turn", inputTokens: 1000, outputTokens: 200, apiMs: 900 };

/** A live stand-in that answers after `delayMs` and remembers what it was asked. */
function fakeLive(delayMs = 0, detectModel = OPTIONS_MODEL): OptionsMessenger & { asked: string[] } {
  const asked: string[] = [];
  const answer = (options: ForkOption[]): Promise<MessengerResult> =>
    new Promise((resolve) => setTimeout(() => resolve({ options, usage: USAGE, trace: TRACE }), delayMs));
  return {
    name: "haiku",
    detectModel,
    asked,
    detect(reply) {
      asked.push(reply);
      return answer(TWO);
    },
    rewrite(options, instruction) {
      asked.push(instruction);
      return answer(options.map((o) => ({ ...o, prompt: `${instruction}: ${o.prompt}` })));
    },
  };
}

function seedReply(chatId: string, forkedFrom: string | null = null): ReplyDoneInfo {
  const t = new Date();
  if (forkedFrom) db.insert(chats).values({ id: forkedFrom, userId: USER, title: "parent", createdAt: t, updatedAt: t }).run();
  db.insert(chats).values({ id: chatId, userId: USER, title: "chat", forkedFrom, createdAt: t, updatedAt: t }).run();
  const messageId = uuidv7();
  const generationId = uuidv7();
  db.insert(messages)
    .values({ id: messageId, chatId, role: "assistant", position: 1, content: [{ type: "text", text: "A or B", citations: null }], status: "done", generationId, createdAt: t, updatedAt: t })
    .run();
  db.insert(generations)
    .values({ id: generationId, chatId, userId: USER, messageId, userMessageId: uuidv7(), status: "done", requestedModel: "claude-sonnet-5-5", startedAt: t })
    .run();
  return { chatId, messageId, generationId, userId: USER, scenario: null, billable: true, text: "A or B" };
}

beforeEach(() => {
  db = createTestDb();
  seedUser(db, USER);
});

describe("OptionsService", () => {
  it("stores Haiku's options on the reply, prices the call and adds the spend", async () => {
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, live: () => live });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    expect(await service.awaitOptions(info.messageId, 1000)).toEqual(TWO);
    expect(db.select().from(messages).where(eq(messages.id, info.messageId)).get()!.forkOptions).toEqual(TWO);
    const rows = db.select().from(usageEvents).where(eq(usageEvents.userId, USER)).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ model: OPTIONS_MODEL, iterationType: "options", inputTokens: 1000, generationId: info.generationId });
    expect(rows[0]!.costUsd).toBeGreaterThan(0);
    expect(db.select().from(users).where(eq(users.id, USER)).get()!.costSpentUsd).toBe(rows[0]!.costUsd);
    expect(live.asked).toEqual(["A or B"]);
    // The call's trace is handed out once.
    const trace = service.takeTrace(info.messageId)!;
    expect(trace).toMatchObject(TRACE);
    expect(trace.totalMs).toBeGreaterThanOrEqual(0);
    expect(service.takeTrace(info.messageId)).toBeNull();
  });

  it("bills a detection at the model the messenger calls", async () => {
    const service = new OptionsService({ db, replayMode: false, live: () => fakeLive(0, "claude-sonnet-5-5") });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    await service.awaitOptions(info.messageId, 1000);
    expect(db.select().from(usageEvents).get()).toMatchObject({ model: "claude-sonnet-5-5", costUsd: costOf("claude-sonnet-5-5", USAGE) });
  });

  it("charges a guest's Explore call to its budgets", async () => {
    db.update(users).set({ role: "guest", budgetKeys: ["ip:203.0.113.7"] }).where(eq(users.id, USER)).run();
    const quota = new QuotaManager(db, { maxPromptTokens: 60_000, budgets: new Budgets(db, { ip: 1, ip48: 3, all: 10 }, () => 0) });
    const service = new OptionsService({ db, replayMode: false, quota, live: () => fakeLive() });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    await service.awaitOptions(info.messageId, 1000);
    const cost = db.select().from(usageEvents).get()!.costUsd;
    expect(cost).toBeGreaterThan(0);
    expect(db.select().from(spendBuckets).all().map((b) => b.levelUsd)).toEqual([cost, cost]);
  });

  it("records and charges the estimated cost of a call that broke off partway, and the detection fails", async () => {
    const broken: OptionsMessenger = { name: "haiku", detectModel: OPTIONS_MODEL, detect: async () => Promise.reject(new OptionsCallError(USAGE, { cause: new Error("lost") })), rewrite: async () => ({ options: [], usage: null }) };
    const service = new OptionsService({ db, replayMode: false, live: () => broken });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    expect(await service.awaitOptions(info.messageId, 1000)).toBeNull();
    const row = db.select().from(usageEvents).get()!;
    expect(row).toMatchObject({ iterationType: "options", inputTokens: 1000, outputTokens: 200, estimated: true });
    expect(db.select().from(users).where(eq(users.id, USER)).get()!.costSpentUsd).toBe(row.costUsd);
    expect(db.select().from(messages).where(eq(messages.id, info.messageId)).get()!.forkOptions).toBeNull();
  });

  it("asks Haiku nothing for a guest whose budget is spent, and refuses its rewrite with the wait", async () => {
    db.update(users).set({ role: "guest", budgetKeys: ["ip:203.0.113.7"] }).where(eq(users.id, USER)).run();
    db.insert(spendBuckets).values({ key: "ip:203.0.113.7", levelUsd: 1.5, updatedAt: new Date(0) }).run();
    const quota = new QuotaManager(db, { maxPromptTokens: 60_000, budgets: new Budgets(db, { ip: 1, ip48: 3, all: 10 }, () => 0) });
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, quota, live: () => live });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    expect(await service.awaitOptions(info.messageId, 100)).toBeNull();
    const refused = await service.rewrite(USER, info.messageId, TWO, "shorter").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(BudgetExceededError);
    expect(refused).toMatchObject({ retryAfterMs: 43_200_000 });
    expect(live.asked).toEqual([]);
  });

  it("caps a guest's running Haiku calls at two and all guests' at a total: past that a detection waits for a slot and a rewrite is busy", async () => {
    db.update(users).set({ role: "guest" }).where(eq(users.id, USER)).run();
    seedUser(db, "g2", { role: "guest" });
    const live = fakeLive(20);
    const service = new OptionsService({ db, replayMode: false, live: () => live, guestRunning: { perGuest: 2, total: 3 } });
    const replies = [seedReply(uuidv7()), seedReply(uuidv7()), seedReply(uuidv7())];
    for (const info of replies) service.onReplyDone(info);
    const message = replies[0]!.messageId;
    expect(await service.rewrite(USER, message, TWO, "shorter").catch((e: unknown) => e)).toBeInstanceOf(BusyError);
    const last = service.rewrite("g2", message, TWO, "shorter");
    expect(await service.rewrite("g2", message, TWO, "longer").catch((e: unknown) => e)).toBeInstanceOf(BusyError);
    await last;
    expect(await Promise.all(replies.map((r) => service.awaitOptions(r.messageId, 1000)))).toEqual([TWO, TWO, TWO]);
    expect(live.asked).toEqual(["A or B", "A or B", "shorter", "A or B"]);
    expect((await service.rewrite(USER, message, TWO, "again")).options).toHaveLength(2);
  });

  it("leaves the options spent when the chat was forked before Haiku answered", async () => {
    const service = new OptionsService({ db, replayMode: false, live: () => fakeLive(20) });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    db.update(messages).set({ forkOptions: [] }).where(eq(messages.id, info.messageId)).run();
    await new Promise<void>((resolve) => {
      const watched = service.watch(info.messageId, (state) => {
        if (!state.done) return;
        watched?.stop();
        resolve();
      });
    });
    expect(db.select().from(messages).where(eq(messages.id, info.messageId)).get()!.forkOptions).toEqual([]);
  });

  it("awaitOptions hands over the answer still in flight, and null when nothing ran", async () => {
    const service = new OptionsService({ db, replayMode: false, live: () => fakeLive(30) });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    expect(await service.awaitOptions(info.messageId, 5)).toBeNull();
    expect(await service.awaitOptions(info.messageId, 1000)).toEqual(TWO);
    expect(await service.awaitOptions(uuidv7(), 10)).toBeNull();
  });

  it("skips forks, empty replies, chats with all their forks, and users at their cap", async () => {
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, live: () => live });
    const fork = seedReply(uuidv7(), uuidv7());
    service.onReplyDone(fork);
    expect(await service.awaitOptions(fork.messageId, 100)).toBeNull();
    const empty = seedReply(uuidv7());
    service.onReplyDone({ ...empty, text: "   " });
    expect(await service.awaitOptions(empty.messageId, 100)).toBeNull();
    const full = seedReply(uuidv7());
    const t = new Date();
    for (let i = 0; i < MAX_FORKS; i++) db.insert(chats).values({ id: uuidv7(), userId: USER, title: `fork ${i}`, forkedFrom: full.chatId, createdAt: t, updatedAt: t }).run();
    service.onReplyDone(full);
    expect(await service.awaitOptions(full.messageId, 100)).toBeNull();
    db.update(users).set({ costCapUsd: 1, costSpentUsd: 1 }).where(eq(users.id, USER)).run();
    const capped = seedReply(uuidv7());
    service.onReplyDone(capped);
    expect(await service.awaitOptions(capped.messageId, 100)).toBeNull();
    expect(live.asked).toEqual([]);
    expect(db.select().from(usageEvents).all()).toHaveLength(0);
  });

  it("with Explore options off in Settings, asks Haiku nothing and spends nothing, until it is back on", async () => {
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, live: () => live });
    db.update(users).set({ exploreOptions: false }).where(eq(users.id, USER)).run();
    const off = seedReply(uuidv7());
    service.onReplyDone(off);
    expect(await service.awaitOptions(off.messageId, 100)).toBeNull();
    const scripted = seedReply(uuidv7());
    service.onReplyDone({ ...scripted, scenario: "options_reply", billable: false });
    expect(await service.awaitOptions(scripted.messageId, 100)).toBeNull();
    expect(service.detectLastReply(off.chatId, USER)).toBeNull();
    expect(live.asked).toEqual([]);
    expect(db.select().from(usageEvents).all()).toHaveLength(0);
    // The reply stays "not run", not "no options".
    expect(db.select().from(messages).where(eq(messages.id, off.messageId)).get()!.forkOptions).toBeNull();

    db.update(users).set({ exploreOptions: true }).where(eq(users.id, USER)).run();
    const on = seedReply(uuidv7());
    service.onReplyDone(on);
    expect(await service.awaitOptions(on.messageId, 1000)).toEqual(TWO);
    expect(live.asked).toEqual(["A or B"]);
  });

  it("scenario runs and replay mode answer from the script and spend nothing", async () => {
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, live: () => live });
    const scripted = seedReply(uuidv7());
    service.onReplyDone({ ...scripted, scenario: "options_reply", billable: false });
    expect(await service.awaitOptions(scripted.messageId, 3000)).toEqual(SCRIPTED_OPTIONS);
    const rewritten = await new OptionsService({ db, replayMode: true }).rewrite(USER, scripted.messageId, SCRIPTED_OPTIONS.slice(0, 2), "Assess cost");
    expect(rewritten.options.map((o) => o.title)).toEqual(SCRIPTED_OPTIONS.slice(0, 2).map((o) => o.title));
    expect(rewritten.trace).toBeNull();
    const plain = seedReply(uuidv7());
    service.onReplyDone({ ...plain, scenario: "normal", billable: false });
    expect(await service.awaitOptions(plain.messageId, 100)).toEqual([]);
    const replay = new OptionsService({ db, replayMode: true, live: () => live });
    const replayed = seedReply(uuidv7());
    replay.onReplyDone(replayed);
    expect(await replay.awaitOptions(replayed.messageId, 100)).toEqual([]);
    expect(live.asked).toEqual([]);
    expect(db.select().from(usageEvents).all()).toHaveLength(0);
  });

  it("detectLastReply reads a chat's last reply after the fact, once", async () => {
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, live: () => live });
    const info = seedReply(uuidv7());
    expect(service.detectLastReply(info.chatId, USER)).toBe(info.messageId);
    expect(await service.awaitOptions(info.messageId, 1000)).toEqual(TWO);
    expect(service.detectLastReply(info.chatId, USER)).toBe(info.messageId);
    expect(live.asked).toHaveLength(1);
    expect(db.select().from(usageEvents).all()).toHaveLength(1);
    expect(service.detectLastReply(uuidv7(), USER)).toBeNull();
  });

  it("detectLastReply reads only replies, never the user's message before a stopped one", () => {
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, live: () => live });
    const info = seedReply(uuidv7());
    const t = new Date();
    db.update(messages).set({ status: "stopped", position: 1 }).where(eq(messages.id, info.messageId)).run();
    db.insert(messages)
      .values({ id: uuidv7(), chatId: info.chatId, role: "user", position: 0, content: [{ type: "text", text: "A or B?", citations: null }], status: "done", createdAt: t, updatedAt: t })
      .run();
    expect(service.detectLastReply(info.chatId, USER)).toBeNull();
    expect(live.asked).toEqual([]);
  });

  it("watch follows a detection: the count, the options so far, then done; a failure ends it as failed", async () => {
    const progressive: OptionsMessenger = {
      name: "haiku",
      detectModel: OPTIONS_MODEL,
      async detect(_reply, onProgress) {
        onProgress?.({ count: 2 });
        await new Promise((r) => setTimeout(r, 5));
        onProgress?.({ options: TWO.slice(0, 1) });
        await new Promise((r) => setTimeout(r, 5));
        return { options: TWO, usage: USAGE, trace: TRACE };
      },
      rewrite: async () => ({ options: [], usage: null }),
    };
    const service = new OptionsService({ db, replayMode: false, live: () => progressive });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    const seen: string[] = [];
    const watched = service.watch(info.messageId, (s) => seen.push(`${s.count}:${s.options.length}:${s.done}`))!;
    expect(watched.state).toMatchObject({ count: 2, done: false });
    await service.awaitOptions(info.messageId, 1000);
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual(["2:1:false", "2:2:true"]);
    watched.stop();
    expect(service.watch(uuidv7(), () => {})).toBeNull();

    const broken: OptionsMessenger = { name: "haiku", detectModel: OPTIONS_MODEL, detect: async () => Promise.reject(new Error("boom")), rewrite: async () => ({ options: [], usage: null }) };
    const failing = new OptionsService({ db, replayMode: false, live: () => broken });
    const other = seedReply(uuidv7());
    failing.onReplyDone(other);
    const states: boolean[] = [];
    failing.watch(other.messageId, (s) => states.push(s.failed));
    await failing.awaitOptions(other.messageId, 1000);
    await new Promise((r) => setTimeout(r, 0));
    expect(states).toEqual([true]);
  });

  it("keeps the spend when the chat was deleted while Haiku answered", async () => {
    const service = new OptionsService({ db, replayMode: false, live: () => fakeLive(20) });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    db.delete(chats).where(eq(chats.id, info.chatId)).run();
    expect(await service.awaitOptions(info.messageId, 1000)).toEqual(TWO);
    const rows = db.select().from(usageEvents).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.generationId).toBeNull();
  });

  it("rewrites through the live messenger for a live reply and records the spend", async () => {
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, live: () => live });
    const info = seedReply(uuidv7());
    const { options: out, trace } = await service.rewrite(USER, info.messageId, TWO, "Focus on cost");
    expect(trace).toEqual(TRACE);
    expect(out.map((o) => o.prompt)).toEqual(["Focus on cost: Explore A", "Focus on cost: Explore B"]);
    expect(db.select().from(usageEvents).all()[0]).toMatchObject({ iterationType: "options_rewrite" });
  });
});
