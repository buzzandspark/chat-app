import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import type { Db } from "@db/client";
import { chats, messages } from "@db/schema";
import { createTestDb, seedChat, seedMessage, seedUser } from "@relay/test-utils";
import { deleteChat, ownsChat, replacedGenerationIds, updateChat } from "./chats";
import { seedLongChat } from "./long-chat";

let db: Db;

beforeEach(() => {
  db = createTestDb();
  seedUser(db, "u1");
  seedUser(db, "u2");
  seedChat(db, "c1", "u1", { title: "Mine" });
  seedChat(db, "c2", "u2", { title: "Theirs" });
});

describe("updateChat", () => {
  it("applies only the given fields to the owner's chat", () => {
    expect(updateChat("u1", "c1", { pinned: true }, db)).toBe(true);
    expect(db.select().from(chats).where(eq(chats.id, "c1")).get()).toMatchObject({ title: "Mine", pinned: true, tabHidden: false });
  });

  it("refuses another user's chat and leaves it alone", () => {
    expect(updateChat("u1", "c2", { title: "Taken" }, db)).toBe(false);
    expect(db.select().from(chats).where(eq(chats.id, "c2")).get()?.title).toBe("Theirs");
  });
});

describe("ownsChat and deleteChat", () => {
  it("delete cascades the owner's messages", () => {
    seedMessage(db, "m1", "c1", 0);
    expect(ownsChat("u1", "c1", db)).toBe(true);
    expect(deleteChat("u1", "c1", db)).toBe(true);
    expect(db.select().from(messages).all()).toEqual([]);
  });

  it("never touches another user's chat", () => {
    expect(ownsChat("u1", "c2", db)).toBe(false);
    expect(deleteChat("u1", "c2", db)).toBe(false);
    expect(db.select().from(chats).where(eq(chats.id, "c2")).get()).toBeDefined();
  });
});

describe("replacedGenerationIds", () => {
  beforeEach(() => {
    seedMessage(db, "m0", "c1", 0);
    seedMessage(db, "m1", "c1", 1, { generationId: "g1" });
    seedMessage(db, "m2", "c1", 2);
    seedMessage(db, "m3", "c1", 3, { generationId: "g3" });
  });

  it("lists the generations at or after the message", () => {
    expect(replacedGenerationIds("u1", "c1", "m0", db)).toEqual(["g1", "g3"]);
    expect(replacedGenerationIds("u1", "c1", "m2", db)).toEqual(["g3"]);
  });

  it("is empty for another user, another chat, or an unknown message", () => {
    expect(replacedGenerationIds("u2", "c1", "m0", db)).toEqual([]);
    expect(replacedGenerationIds("u1", "c2", "m0", db)).toEqual([]);
    expect(replacedGenerationIds("u1", "c1", "missing", db)).toEqual([]);
  });
});

describe("seedLongChat", () => {
  it("writes 200 finished messages that reopen on the given model", () => {
    const { chatId, messages: count } = seedLongChat("u1", "claude-haiku-5-5", db);
    const rows = db.select().from(messages).where(eq(messages.chatId, chatId)).all();
    expect(count).toBe(200);
    expect(rows).toHaveLength(200);
    expect(rows.filter((r) => r.role === "assistant").every((r) => r.servingModel === "claude-haiku-5-5")).toBe(true);
  });
});
