import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@db/client";
import { chats, generations, messages, usageEvents, users } from "@db/schema";
import type { ForkOption } from "@shared/forks";
import { uuidv7 } from "@shared/id";
import type { ReplyDoneInfo } from "../engine";
import { createTestDb, seedUser } from "../test-utils";
import { OPTIONS_MODEL, SCRIPTED_OPTIONS, type MessengerResult, type OptionsMessenger } from "./messenger";
import { OptionsService } from "./service";

const USER = "u1";
let db: Db;

const TWO: ForkOption[] = [
  { title: "Option A", prompt: "Explore A" },
  { title: "Option B", prompt: "Explore B" },
];
const USAGE = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** A live stand-in that answers after `delayMs` and remembers what it was asked. */
function fakeLive(delayMs = 0): OptionsMessenger & { asked: string[] } {
  const asked: string[] = [];
  const answer = (options: ForkOption[]): Promise<MessengerResult> =>
    new Promise((resolve) => setTimeout(() => resolve({ options, usage: USAGE }), delayMs));
  return {
    name: "haiku",
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
  });

  it("awaitOptions hands over the answer still in flight, and null when nothing ran", async () => {
    const service = new OptionsService({ db, replayMode: false, live: () => fakeLive(30) });
    const info = seedReply(uuidv7());
    service.onReplyDone(info);
    expect(await service.awaitOptions(info.messageId, 5)).toBeNull();
    expect(await service.awaitOptions(info.messageId, 1000)).toEqual(TWO);
    expect(await service.awaitOptions(uuidv7(), 10)).toBeNull();
  });

  it("skips forks, empty replies and users at their cap", async () => {
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, live: () => live });
    const fork = seedReply(uuidv7(), uuidv7());
    service.onReplyDone(fork);
    expect(await service.awaitOptions(fork.messageId, 100)).toBeNull();
    const empty = seedReply(uuidv7());
    service.onReplyDone({ ...empty, text: "   " });
    expect(await service.awaitOptions(empty.messageId, 100)).toBeNull();
    db.update(users).set({ costCapUsd: 1, costSpentUsd: 1 }).where(eq(users.id, USER)).run();
    const capped = seedReply(uuidv7());
    service.onReplyDone(capped);
    expect(await service.awaitOptions(capped.messageId, 100)).toBeNull();
    expect(live.asked).toEqual([]);
    expect(db.select().from(usageEvents).all()).toHaveLength(0);
  });

  it("scenario runs and replay mode answer from the script and spend nothing", async () => {
    const live = fakeLive();
    const service = new OptionsService({ db, replayMode: false, live: () => live });
    const scripted = seedReply(uuidv7());
    service.onReplyDone({ ...scripted, scenario: "options_reply", billable: false });
    expect(await service.awaitOptions(scripted.messageId, 100)).toEqual(SCRIPTED_OPTIONS);
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
    const out = await service.rewrite(USER, info.messageId, TWO, "Focus on cost");
    expect(out.map((o) => o.prompt)).toEqual(["Focus on cost: Explore A", "Focus on cost: Explore B"]);
    expect(db.select().from(usageEvents).all()[0]).toMatchObject({ iterationType: "options_rewrite" });
  });
});
