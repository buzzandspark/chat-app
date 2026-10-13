// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@server/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/current-user")>()),
  requireUser: vi.fn(),
}));
vi.hoisted(() => {
  process.env.DATABASE_PATH = ":memory:";
});

import { openDatabase, schema } from "@db/client";
import { applyMigrations } from "@db/migrator";
import { requireUser } from "@server/current-user";
import { getLimiters } from "@server/ratelimit";
import type { SearchResponse } from "@shared/api";
import { ftsQuery, GET } from "./route";

const { db, sqlite } = openDatabase();
let clock = 0;

function addChat(userId: string, id: string, texts: string[]): void {
  db.insert(schema.chats).values({ id, userId, title: `Chat ${id}`, createdAt: new Date(++clock), updatedAt: new Date(++clock) }).run();
  db.insert(schema.messages)
    .values(texts.map((text, position) => ({ id: `${id}-m${position}`, chatId: id, role: "user" as const, position, content: [{ type: "text" as const, text, citations: null }] })))
    .run();
}

async function search(q: string): Promise<SearchResponse["hits"]> {
  const res = await GET(new NextRequest(`http://localhost/api/chats/search?q=${encodeURIComponent(q)}`));
  expect(res.status).toBe(200);
  return ((await res.json()) as SearchResponse).hits;
}

beforeAll(() => {
  applyMigrations(sqlite);
  for (const id of ["me", "other"]) db.insert(schema.users).values({ id, name: id, email: `${id}@example.com` }).run();
  addChat("me", "old", ["a react hooks question"]);
  addChat("other", "theirs", ["react is mine"]);
  addChat("me", "busy", Array.from({ length: 250 }, (_, i) => `more react stuff ${i}`));
});

beforeEach(() => {
  getLimiters().search.reset();
  vi.mocked(requireUser).mockResolvedValue({ id: "me", role: "user", email: "me@example.com", name: "Me" });
});

describe("GET /api/chats/search", () => {
  it("finds an older chat behind a newer one with hundreds of matches, one hit per chat", async () => {
    const hits = await search("react");
    expect(hits.map((h) => h.chatId)).toEqual(["busy", "old"]);
    expect(hits[0]).toMatchObject({ messageId: "busy-m249", snippet: "more react stuff 249" });
    expect(hits[1]).toMatchObject({ messageId: "old-m0", snippet: "a react hooks question" });
  });

  it("prefix-matches short tokens and the last one, longer earlier ones and single characters as whole words", async () => {
    expect((await search("rea ques")).map((h) => h.chatId)).toEqual(["old"]);
    expect((await search("react ques")).map((h) => h.chatId)).toEqual(["old"]);
    expect(await search("reac ques")).toEqual([]);
    expect((await search("a react")).map((h) => h.chatId)).toEqual(["old"]);
    expect(await search("!! ??")).toEqual([]);
  });

  it("matches message text only, never the caller's hex id in the index (\"me\" is 6d65)", async () => {
    expect(await search("6d")).toEqual([]);
    expect(await search("react 6d6")).toEqual([]);
  });

  it("searches the caller's own messages only, and follows a chat to a new owner", async () => {
    expect((await search("mine")).length).toBe(0);
    vi.mocked(requireUser).mockResolvedValue({ id: "other", role: "user", email: "other@example.com", name: "Other" });
    expect((await search("react")).map((h) => h.chatId)).toEqual(["theirs"]);
    sqlite.prepare("UPDATE chats SET user_id = 'other' WHERE id = 'old'").run();
    expect((await search("hooks")).map((h) => h.chatId)).toEqual(["old"]);
    sqlite.prepare("UPDATE chats SET user_id = 'me' WHERE id = 'old'").run();
  });

  it("refuses a caller past the search rate", async () => {
    for (let i = 0; i < 120; i++) getLimiters().search.check("me");
    const res = await GET(new NextRequest("http://localhost/api/chats/search?q=react"));
    expect(res.status).toBe(429);
  });
});

describe("ftsQuery", () => {
  it("scopes to the owner and quotes every token", () => {
    expect(ftsQuery("u1", 'th "x y hooks quest')).toBe('search_owner:7531 AND search_text:("th"* """x"* "y" "hooks" "quest"*)');
    expect(ftsQuery("u1", "   ")).toBe("");
  });
});
