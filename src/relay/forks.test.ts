import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@db/client";
import { chats, generations, messages } from "@db/schema";
import { uuidv7 } from "@shared/id";
import type { HistoryMessage } from "./anthropic/history";
import { buildRequest } from "./anthropic/request";
import { BusyError, Engine, type StartInput } from "./engine";
import { createForks, declareWinner, deleteForks, duplicateChat, ForkError, setForkOrder, type ForkRequest } from "./forks";
import { ScriptedProvider } from "./providers/scripted";
import type { Provider, ProviderRequest, ProviderStreamOptions } from "./providers/types";
import { scenarioScript, type ScenarioName } from "./scenarios";
import { EventStore } from "./store";
import { collectUntilTerminal, createTestDb, seedUser } from "./test-utils";

const USER = "u1";
let db: Db;
let store: EventStore;
let engine: Engine;
/** Whether fork 1 had its message_start when each later request went upstream. */
let callsSeen: { generationId: string | undefined; firstBegun: boolean }[];
let firstGeneration: string | null;

function liveLike(): Provider {
  const scripted = new ScriptedProvider((req) => scenarioScript((req.scenario as ScenarioName) ?? "normal", req), 0);
  return {
    name: "anthropic",
    stream(req: ProviderRequest, opts: ProviderStreamOptions) {
      const firstBegun = firstGeneration !== null && (store.get(firstGeneration)?.events.some((e) => e.type === "message_start") ?? false);
      callsSeen.push({ generationId: req.userId, firstBegun });
      return scripted.stream(req, opts);
    },
  };
}

function fork(title = "Option"): ForkRequest {
  return { chatId: uuidv7(), generationId: uuidv7(), userMessageId: uuidv7(), assistantMessageId: uuidv7(), title, prompt: `Explore ${title}` };
}

async function parentChat(turns = 1, extra: Partial<StartInput> = {}): Promise<string> {
  const chatId = uuidv7();
  for (let i = 0; i < turns; i++) {
    const inp: StartInput = {
      generationId: uuidv7(),
      chatId,
      userId: USER,
      userRole: "user",
      userMessageId: uuidv7(),
      assistantMessageId: uuidv7(),
      text: `question ${i}`,
      model: "claude-opus-5-5",
      thinking: { harder: true },
      ...extra,
    };
    engine.start(inp);
    await collectUntilTerminal(store, inp.generationId);
  }
  return chatId;
}

const deps = () => ({ db, engine, store, gateMs: 2000 });

beforeEach(() => {
  db = createTestDb();
  store = new EventStore();
  seedUser(db, USER);
  callsSeen = [];
  firstGeneration = null;
  engine = new Engine({ db, store, providers: () => liveLike(), partialPersistMs: 50 });
});

describe("createForks", () => {
  it("copies every parent row, then asks the parent's model and effort the prompt as the first own turn", async () => {
    const parentId = await parentChat(2);
    const forks = [fork("A"), fork("B")];
    const started = createForks(deps(), { userId: USER, userRole: "user", parentId, forks });
    expect(started.map((s) => s.chatId)).toEqual(forks.map((f) => f.chatId));
    await Promise.all(started.map((s) => collectUntilTerminal(store, s.generationId)));

    const parentRows = db.select().from(messages).where(eq(messages.chatId, parentId)).orderBy(asc(messages.position)).all();
    for (const [i, f] of forks.entries()) {
      const chat = db.select().from(chats).where(eq(chats.id, f.chatId)).get()!;
      expect(chat).toMatchObject({ title: f.title, forkedFrom: parentId, forkPosition: parentRows.length, forkOrder: i });
      const rows = db.select().from(messages).where(eq(messages.chatId, f.chatId)).orderBy(asc(messages.position)).all();
      expect(rows).toHaveLength(parentRows.length + 2);
      rows.slice(0, parentRows.length).forEach((r, j) => {
        const p = parentRows[j]!;
        expect(r.id).not.toBe(p.id);
        expect({ role: r.role, position: r.position, content: r.content, status: r.status, thinking: r.thinking }).toEqual({
          role: p.role,
          position: p.position,
          content: p.content,
          status: p.status,
          thinking: p.thinking,
        });
      });
      const [prompt, reply] = rows.slice(-2);
      expect(prompt).toMatchObject({ id: f.userMessageId, role: "user", position: parentRows.length });
      expect(prompt!.content).toEqual([{ type: "text", text: f.prompt, citations: null }]);
      expect(reply).toMatchObject({ id: f.assistantMessageId, status: "done", requestedModel: "claude-opus-5-5", thinking: { harder: true } });
    }
    expect(parentRows.at(-1)!.forkOptions).toEqual([]);
  });

  it("starts the first fork alone and the rest once its message has begun", async () => {
    const parentId = await parentChat();
    const forks = [fork("A"), fork("B"), fork("C")];
    firstGeneration = forks[0]!.generationId;
    const started = createForks(deps(), { userId: USER, userRole: "user", parentId, forks });
    // Every fork has its rows, buffer and `started` event at once.
    for (const s of started) expect(store.get(s.generationId)!.events[0]!.type).toBe("started");
    await Promise.all(started.map((s) => collectUntilTerminal(store, s.generationId)));
    const parentCalls = 1;
    expect(callsSeen).toHaveLength(parentCalls + 3);
    expect(callsSeen.slice(parentCalls + 1).every((c) => c.firstBegun)).toBe(true);
  });

  it("a fork's first request equals the parent's last request in everything but the appended turns", async () => {
    const parentId = await parentChat(2);
    const [f] = [fork("A")];
    const [started] = createForks(deps(), { userId: USER, userRole: "user", parentId, forks: [f!] });
    await collectUntilTerminal(store, started!.generationId);

    const history = (chatId: string, before: string): HistoryMessage[] => {
      const rows = db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.position)).all();
      const cutoff = rows.find((r) => r.id === before)!.position;
      return rows.filter((r) => r.position < cutoff).map((r) => ({ role: r.role, content: r.content, status: r.status }));
    };
    const parentRows = db.select().from(messages).where(eq(messages.chatId, parentId)).orderBy(asc(messages.position)).all();
    const parentReply = parentRows.at(-1)!;
    const forkReply = db.select().from(messages).where(eq(messages.id, f!.assistantMessageId)).get()!;
    const parentRequest = buildRequest({ model: "claude-opus-5-5", thinking: parentReply.thinking!, messages: history(parentId, parentReply.id), userId: USER });
    const forkRequest = buildRequest({
      model: forkReply.requestedModel as "claude-opus-5-5",
      thinking: forkReply.thinking!,
      messages: history(f!.chatId, forkReply.id),
      userId: USER,
      cacheTail: true,
    });
    const { messages: parentMessages, ...parentRest } = parentRequest;
    const { messages: forkMessages, ...forkRest } = forkRequest;
    expect(forkRest).toEqual(parentRest);
    const strip = (list: Anthropic.Beta.BetaMessageParam[]) =>
      list.map((m) => ({ role: m.role, content: (m.content as object[]).map((b) => Object.fromEntries(Object.entries(b).filter(([k]) => k !== "cache_control"))) }));
    expect(strip(forkMessages).slice(0, parentMessages.length)).toEqual(strip(parentMessages));
    expect(forkMessages).toHaveLength(parentMessages.length + 2);
    expect(forkMessages.at(-2)!.role).toBe("assistant");
    expect(forkMessages.at(-1)!.role).toBe("user");
  });

  it("runs a guest's whole fan-out as one of its two running replies", async () => {
    seedUser(db, "g1", { role: "guest", costCapUsd: 1 });
    const parentId = await parentChat(1, { userId: "g1", userRole: "guest" });
    const started = createForks(deps(), { userId: "g1", userRole: "guest", parentId, forks: [fork("A"), fork("B"), fork("C")] });
    expect(started).toHaveLength(3);
    const send = (): StartInput => ({ generationId: uuidv7(), chatId: uuidv7(), userId: "g1", userRole: "guest", userMessageId: uuidv7(), assistantMessageId: uuidv7(), text: "hi", model: "claude-haiku-5-5", thinking: { harder: false } });
    const own = send();
    expect(engine.start(own)).toEqual({ created: true });
    expect(() => engine.start(send())).toThrow(BusyError);
    await Promise.all([...started, own].map((s) => collectUntilTerminal(store, s.generationId)));
  });

  it("refuses another user's chat, a fork of a fork, and more than the cap", async () => {
    const parentId = await parentChat();
    seedUser(db, "u2");
    expect(() => createForks(deps(), { userId: "u2", userRole: "user", parentId, forks: [fork()] })).toThrow(ForkError);
    const [first] = createForks(deps(), { userId: USER, userRole: "user", parentId, forks: [fork()] });
    await collectUntilTerminal(store, first!.generationId);
    expect(() => createForks(deps(), { userId: USER, userRole: "user", parentId: first!.chatId, forks: [fork()] })).toThrow(/is_fork/);
    const nine = Array.from({ length: 9 }, (_, i) => fork(`F${i}`));
    expect(() => createForks(deps(), { userId: USER, userRole: "user", parentId, forks: [...nine, fork("ten")] })).toThrow(/too_many/);
    const started = createForks(deps(), { userId: USER, userRole: "user", parentId, forks: nine });
    await Promise.all(started.map((s) => collectUntilTerminal(store, s.generationId)));
    expect(db.select().from(chats).where(eq(chats.forkedFrom, parentId)).all()).toHaveLength(10);
  });

  it("a scenario reply forks as a scripted reply; deleting the parent leaves the fork standing", async () => {
    const parentId = await parentChat(1, { scenario: "normal" });
    const [started] = createForks(deps(), { userId: USER, userRole: "user", parentId, forks: [fork()] });
    await collectUntilTerminal(store, started!.generationId);
    expect(db.select().from(generations).where(eq(generations.id, started!.generationId)).get()!.scenario).toBe("normal");
    db.delete(chats).where(eq(chats.id, parentId)).run();
    const orphan = db.select().from(chats).where(eq(chats.id, started!.chatId)).get()!;
    expect(orphan.forkedFrom).toBeNull();
    expect(db.select().from(messages).where(eq(messages.chatId, started!.chatId)).all().length).toBeGreaterThan(2);
  });

  it("declareWinner keeps the fork alone with its history and deletes the main chat and the other forks", async () => {
    const parentId = await parentChat(2);
    const forks = [fork("A"), fork("B")];
    const started = createForks(deps(), { userId: USER, userRole: "user", parentId, forks });
    await Promise.all(started.map((s) => collectUntilTerminal(store, s.generationId)));
    const winner = forks[1]!.chatId;
    expect(await declareWinner(db, engine, "nobody", winner)).toBeNull();
    expect(await declareWinner(db, engine, USER, parentId)).toBeNull();
    // A reply still streaming in a loser is stopped and settled first.
    engine = new Engine({ db, store, providers: () => new ScriptedProvider((req) => scenarioScript((req.scenario as ScenarioName) ?? "normal", req), 1), partialPersistMs: 50 });
    const slow: StartInput = { generationId: uuidv7(), chatId: forks[0]!.chatId, userId: USER, userRole: "user", userMessageId: uuidv7(), assistantMessageId: uuidv7(), text: "more", model: "claude-opus-5-5", thinking: { harder: true }, scenario: "slow_tokens" };
    engine.start(slow);
    const rowsBefore = db.select().from(messages).where(eq(messages.chatId, winner)).orderBy(asc(messages.position)).all();
    const made = await declareWinner(db, engine, USER, winner);
    expect(made).toEqual({ id: winner, deleted: [parentId, forks[0]!.chatId] });
    expect(engine.runningCount()).toBe(0);
    expect(db.select().from(chats).where(eq(chats.userId, USER)).all().map((c) => c.id)).toEqual([winner]);
    expect(db.select().from(chats).where(eq(chats.id, winner)).get()).toMatchObject({ forkedFrom: null, forkPosition: null, forkOrder: null });
    expect(db.select().from(messages).where(eq(messages.chatId, winner)).orderBy(asc(messages.position)).all()).toEqual(rowsBefore);
    expect(db.select().from(messages).where(eq(messages.chatId, parentId)).all()).toHaveLength(0);
    // Standing alone, it can be forked again.
    const [again] = createForks(deps(), { userId: USER, userRole: "user", parentId: winner, forks: [fork("C")] });
    await collectUntilTerminal(store, again!.generationId);
    expect(db.select().from(chats).where(eq(chats.id, again!.chatId)).get()!.forkedFrom).toBe(winner);
  });

  it("deleteForks removes every fork of a main chat and keeps the main chat", async () => {
    const parentId = await parentChat();
    const forks = [fork("A"), fork("B")];
    const started = createForks(deps(), { userId: USER, userRole: "user", parentId, forks });
    await Promise.all(started.map((s) => collectUntilTerminal(store, s.generationId)));
    expect(await deleteForks(db, engine, "nobody", parentId)).toBeNull();
    expect(await deleteForks(db, engine, USER, forks[0]!.chatId)).toBeNull();
    expect(await deleteForks(db, engine, USER, parentId)).toEqual({ deleted: forks.map((f) => f.chatId) });
    expect(db.select().from(chats).where(eq(chats.userId, USER)).all().map((c) => c.id)).toEqual([parentId]);
    expect(db.select().from(messages).where(eq(messages.chatId, parentId)).all()).toHaveLength(2);
    expect(await deleteForks(db, engine, USER, parentId)).toEqual({ deleted: [] });
  });

  it("deleteForks with the main chat removes it and every fork, and nothing else", async () => {
    const parentId = await parentChat();
    const other = await parentChat();
    const forks = [fork("A"), fork("B")];
    const started = createForks(deps(), { userId: USER, userRole: "user", parentId, forks });
    await Promise.all(started.map((s) => collectUntilTerminal(store, s.generationId)));
    expect(await deleteForks(db, engine, USER, parentId, true)).toEqual({ deleted: [...forks.map((f) => f.chatId), parentId] });
    expect(db.select().from(chats).where(eq(chats.userId, USER)).all().map((c) => c.id)).toEqual([other]);
    expect(db.select().from(messages).where(eq(messages.chatId, parentId)).all()).toHaveLength(0);
  });

  it("setForkOrder stores the given order and keeps unnamed forks after it", async () => {
    const parentId = await parentChat();
    const forks = [fork("A"), fork("B"), fork("C")];
    const started = createForks(deps(), { userId: USER, userRole: "user", parentId, forks });
    await Promise.all(started.map((s) => collectUntilTerminal(store, s.generationId)));
    expect(setForkOrder(db, USER, parentId, [forks[2]!.chatId, forks[0]!.chatId, uuidv7()])).toBe(true);
    const order = db.select({ id: chats.id, forkOrder: chats.forkOrder }).from(chats).where(eq(chats.forkedFrom, parentId)).orderBy(asc(chats.forkOrder)).all();
    expect(order.map((o) => o.id)).toEqual([forks[2]!.chatId, forks[0]!.chatId, forks[1]!.chatId]);
    expect(setForkOrder(db, "nobody", parentId, [])).toBe(false);
  });
});

describe("duplicateChat", () => {
  const rowsOf = (chatId: string) => db.select().from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.position)).all();

  it("copies the chat up to and including the chosen reply into a new fork of the main chat", async () => {
    const parentId = await parentChat(2);
    const parentRows = rowsOf(parentId);
    const firstReply = parentRows.find((r) => r.role === "assistant")!;
    const newChatId = uuidv7();
    const dup = duplicateChat(db, { userId: USER, chatId: parentId, messageId: firstReply.id, newChatId });
    const parent = db.select().from(chats).where(eq(chats.id, parentId)).get()!;
    expect(dup).toEqual({ chatId: newChatId, parentId, title: `${parent.title ?? "New chat"} (copy)`, forkOrder: 0 });
    const copy = db.select().from(chats).where(eq(chats.id, newChatId)).get()!;
    expect(copy).toMatchObject({ forkedFrom: parentId, forkPosition: firstReply.position + 1, forkOrder: 0 });
    const copied = rowsOf(newChatId);
    expect(copied.map((r) => [r.role, r.position, r.content])).toEqual(parentRows.filter((r) => r.position <= firstReply.position).map((r) => [r.role, r.position, r.content]));
    // New rows, not the parent's.
    expect(copied.some((r) => parentRows.some((p) => p.id === r.id))).toBe(false);
  });

  it("duplicates a fork as another fork of the same main chat", async () => {
    const parentId = await parentChat(1);
    const reply = rowsOf(parentId).find((r) => r.role === "assistant")!;
    const first = duplicateChat(db, { userId: USER, chatId: parentId, messageId: reply.id, newChatId: uuidv7() });
    const replyInFork = rowsOf(first.chatId).find((r) => r.role === "assistant")!;
    const second = duplicateChat(db, { userId: USER, chatId: first.chatId, messageId: replyInFork.id, newChatId: uuidv7() });
    expect(second).toMatchObject({ parentId, forkOrder: 1 });
    expect(second.title).toBe(`${first.title} (copy)`);
  });

  it("refuses another user's chat, a message that isn't a finished reply, and an eleventh fork", async () => {
    const parentId = await parentChat(1);
    const rows = rowsOf(parentId);
    const reply = rows.find((r) => r.role === "assistant")!;
    const question = rows.find((r) => r.role === "user")!;
    expect(() => duplicateChat(db, { userId: "u2", chatId: parentId, messageId: reply.id, newChatId: uuidv7() })).toThrow(/not_found/);
    expect(() => duplicateChat(db, { userId: USER, chatId: parentId, messageId: question.id, newChatId: uuidv7() })).toThrow(/not_found/);
    for (let i = 0; i < 10; i++) duplicateChat(db, { userId: USER, chatId: parentId, messageId: reply.id, newChatId: uuidv7() });
    expect(() => duplicateChat(db, { userId: USER, chatId: parentId, messageId: reply.id, newChatId: uuidv7() })).toThrow(ForkError);
  });
});
