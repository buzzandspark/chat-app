import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Db } from "@db/client";
import { chats, generations, messages } from "@db/schema";
import { uuidv7 } from "@shared/id";
import type { HistoryMessage } from "./anthropic/history";
import { buildRequest } from "./anthropic/request";
import { Engine, type StartInput } from "./engine";
import { createForks, ForkError, makeMain, setForkOrder, type ForkRequest } from "./forks";
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

  it("makeMain promotes a fork: the old main takes its place as a fork and the siblings follow", async () => {
    const parentId = await parentChat(2);
    const forks = [fork("A"), fork("B")];
    const started = createForks(deps(), { userId: USER, userRole: "user", parentId, forks });
    await Promise.all(started.map((s) => collectUntilTerminal(store, s.generationId)));
    const promoted = forks[1]!.chatId;
    expect(makeMain(db, "nobody", promoted)).toBeNull();
    expect(makeMain(db, USER, parentId)).toBeNull();
    const made = makeMain(db, USER, promoted)!;
    expect(made).toEqual({ parentId, parentForkPosition: 4, parentForkOrder: 1 });
    const row = (id: string) => db.select().from(chats).where(eq(chats.id, id)).get()!;
    expect(row(promoted)).toMatchObject({ forkedFrom: null, forkPosition: null, forkOrder: null });
    expect(row(parentId)).toMatchObject({ forkedFrom: promoted, forkPosition: 4, forkOrder: 1 });
    expect(row(forks[0]!.chatId)).toMatchObject({ forkedFrom: promoted, forkOrder: 0 });
    // The old main is a fork now, so it cannot be forked; the new main can.
    expect(() => createForks(deps(), { userId: USER, userRole: "user", parentId, forks: [fork()] })).toThrow(/is_fork/);
    const [again] = createForks(deps(), { userId: USER, userRole: "user", parentId: promoted, forks: [fork("C")] });
    await collectUntilTerminal(store, again!.generationId);
    expect(row(again!.chatId).forkedFrom).toBe(promoted);
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
