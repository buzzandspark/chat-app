import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closeDatabase, openDatabase, type DbHandle } from "@db/client";
import { applyMigrations } from "@db/migrator";
import { seedChat, seedMessage, seedUser } from "@relay/test-utils";
import { ftsQuery, searchChats } from "./search";

let handle: DbHandle;

beforeEach(() => {
  closeDatabase();
  handle = openDatabase(":memory:");
  applyMigrations(handle.sqlite);
  const { db } = handle;
  seedUser(db, "u1");
  seedUser(db, "u2");
  seedChat(db, "c1", "u1", { title: "Trip plans", updatedAt: new Date(2000) });
  seedChat(db, "c2", "u1", { title: "Über notes", updatedAt: new Date(1000) });
  seedChat(db, "c3", "u2", { title: "Their trip", updatedAt: new Date(3000) });
  seedMessage(db, "m1", "c2", 0, { content: [{ type: "text", text: "Book the trip to Lisbon", citations: null }] });
  seedMessage(db, "m3", "c3", 0, { content: [{ type: "text", text: "Their Lisbon trip", citations: null }] });
});

describe("ftsQuery", () => {
  it("scopes to the owner and quotes every token", () => {
    expect(ftsQuery("u1", 'th "x y hooks quest')).toBe('search_owner:7531 AND search_text:("th"* """x"* "y" "hooks" "quest"*)');
    expect(ftsQuery("u1", "   ")).toBe("");
  });
});

describe("searchChats", () => {
  it("finds the user's messages and titles, newest first, never another user's", () => {
    const hits = searchChats("u1", "trip", handle);
    expect(hits.map((h) => h.chatId)).toEqual(["c1", "c2"]);
    expect(hits[0]).toMatchObject({ messageId: null, snippet: null });
    expect(hits[1]).toMatchObject({ messageId: "m1", snippet: "Book the trip to Lisbon" });
  });

  it("folds case beyond ASCII in titles", () => {
    expect(searchChats("u1", "über", handle).map((h) => h.chatId)).toEqual(["c2"]);
  });
});
