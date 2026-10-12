import { and, asc, eq, gte } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { generations, messages, usageEvents } from "@db/schema";
import { uuidv7 } from "@shared/id";
import type { Db } from "@db/client";
import { Engine, type StartInput, type StartOutcome } from "./engine";
import { ScriptedProvider } from "./providers/scripted";
import { scenarioScript, type ScenarioName } from "./scenarios";
import { EventStore } from "./store";
import { createTestDb, seedUser, waitFor } from "./test-utils";

let db: Db;
let store: EventStore;
let engine: Engine;
let errors: MockInstance<typeof console.error>;
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

/** A Regenerate of `of`'s reply, as the client sends it. */
function regenerate(of: StartInput): StartInput {
  return input({ chatId: of.chatId, userMessageId: of.userMessageId, text: undefined, replaceFromMessageId: of.assistantMessageId });
}

/** What app/api/chat/route.ts does for a replace: stop the turns it drops, await that, then start. */
async function replace(inp: StartInput, whileWaiting?: () => void): Promise<StartOutcome> {
  const from = db.select({ position: messages.position }).from(messages).where(eq(messages.id, inp.replaceFromMessageId!)).get();
  if (from) {
    const victims = db
      .select({ generationId: messages.generationId })
      .from(messages)
      .where(and(eq(messages.chatId, inp.chatId), gte(messages.position, from.position)))
      .all();
    const settled = Promise.all(victims.map((v) => (v.generationId ? engine.stopAndWait(v.generationId) : Promise.resolve())));
    whileWaiting?.();
    await settled;
  }
  return engine.start(inp);
}

function chatRows(chatId: string): string[] {
  return db.select({ id: messages.id }).from(messages).where(eq(messages.chatId, chatId)).orderBy(asc(messages.position)).all().map((r) => r.id);
}

/** Lets `inp` stream a little, stops it, and checks it wrote its rows and its usage like any stopped reply. */
async function expectSettlesIntact(inp: StartInput) {
  await waitFor(() => store.get(inp.generationId)?.events.some((e) => e.type === "text_delta") ?? false);
  await engine.stopAndWait(inp.generationId);
  expect(db.select({ status: messages.status }).from(messages).where(eq(messages.id, inp.assistantMessageId)).get()?.status).toBe("stopped");
  expect(db.select({ status: generations.status }).from(generations).where(eq(generations.id, inp.generationId)).get()?.status).toBe("stopped");
  expect(db.select().from(usageEvents).where(eq(usageEvents.generationId, inp.generationId)).all().length).toBeGreaterThan(0);
  expect(errors.mock.calls.filter((c) => String(c[0]).includes("finalize failed"))).toEqual([]);
}

beforeEach(() => {
  db = createTestDb();
  store = new EventStore();
  seedUser(db, USER);
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  // Billed like the live provider, so a lost usage row would show; slow_tokens at 10x stays running until stopped.
  const scripted = new ScriptedProvider((req) => scenarioScript((req.scenario as ScenarioName) ?? "normal", req), 10);
  const asLive = { name: "anthropic" as const, stream: scripted.stream.bind(scripted) };
  engine = new Engine({ db, store, providers: () => asLive, partialPersistMs: 50 });
});

afterEach(async () => {
  await engine.drain();
  errors.mockRestore();
});

/** Three turns, the last still streaming: u0 a0, u1 a1 (stopped), u2 a2 (running). */
async function threeTurns() {
  const t0 = input();
  engine.start(t0);
  await engine.stopAndWait(t0.generationId);
  const t1 = input({ chatId: t0.chatId });
  engine.start(t1);
  await engine.stopAndWait(t1.generationId);
  const t2 = input({ chatId: t0.chatId });
  engine.start(t2);
  return { t0, t1, t2 };
}

describe("replace races", () => {
  it("two Regenerates waiting on the same running reply: the later one is refused, not left to delete the first's rows", async () => {
    const { t0, t1 } = await threeTurns();
    const regenA1 = regenerate(t1);
    const regenA0 = regenerate(t0);
    const [first, second] = await Promise.all([replace(regenA1), replace(regenA0)]);
    expect(first).toEqual({ created: true });
    expect(second).toEqual({ created: false, reason: "replace_running" });
    // Refused before anything was written: the first's turns stand.
    expect(chatRows(t0.chatId)).toEqual([t0.userMessageId, t0.assistantMessageId, t1.userMessageId, regenA1.assistantMessageId]);
    await expectSettlesIntact(regenA1);
    // The client sends the refused request again; this time the route stops the reply it drops first.
    expect(await replace(regenA0)).toEqual({ created: true });
    expect(chatRows(t0.chatId)).toEqual([t0.userMessageId, regenA0.assistantMessageId]);
  });

  it("a send from another tab while a Regenerate waits keeps its rows; the Regenerate is refused", async () => {
    const { t0 } = await threeTurns();
    const late = input({ chatId: t0.chatId, text: "from the other tab" });
    const regenA0 = regenerate(t0);
    const outcome = await replace(regenA0, () => expect(engine.start(late)).toEqual({ created: true }));
    expect(outcome).toEqual({ created: false, reason: "replace_running" });
    expect(chatRows(t0.chatId).slice(-2)).toEqual([late.userMessageId, late.assistantMessageId]);
    await expectSettlesIntact(late);
  });

  it("a replace whose target another request already replaced is refused instead of appending a second reply", async () => {
    const { t0, t1 } = await threeTurns();
    const a = regenerate(t1);
    const b = regenerate(t1);
    const [first, second] = await Promise.all([replace(a), replace(b)]);
    expect(first).toEqual({ created: true });
    expect(second).toEqual({ created: false, reason: "replace_gone" });
    expect(chatRows(t0.chatId)).toEqual([t0.userMessageId, t0.assistantMessageId, t1.userMessageId, a.assistantMessageId]);
    // An Edit of a user message that is gone is refused the same way.
    const edit = input({ chatId: t0.chatId, text: "edited", replaceFromMessageId: uuidv7() });
    expect(engine.start(edit)).toEqual({ created: false, reason: "replace_gone" });
    expect(db.select().from(generations).where(eq(generations.id, edit.generationId)).get()).toBeUndefined();
    await expectSettlesIntact(a);
  });

  it("parallel regenerates of one reply start one generation; the rest find it replaced", async () => {
    const victim = input();
    expect(engine.start(victim)).toEqual({ created: true });
    const outcomes = await Promise.all(
      Array.from({ length: 6 }, async () => {
        await engine.stopAndWait(victim.generationId);
        return engine.start(regenerate(victim));
      }),
    );
    expect(outcomes.filter((o) => o.created)).toHaveLength(1);
    expect(outcomes.filter((o) => !o.created && o.reason === "replace_gone")).toHaveLength(5);
  });

  it("a duplicate POST of a replace that started attaches to it rather than being refused", async () => {
    const { t1 } = await threeTurns();
    const regenA1 = regenerate(t1);
    expect(await replace(regenA1)).toEqual({ created: true });
    // Its target is gone by now and its own reply is running, but `exists` is answered first.
    expect(engine.start(regenA1)).toEqual({ created: false, reason: "exists" });
  });
});
