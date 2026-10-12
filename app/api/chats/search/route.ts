import type { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@db/client";
import { errorResponse, requireUser } from "@server/current-user";

export interface SearchHit {
  chatId: string;
  title: string;
  snippet: string | null;
  /** The first message that matched, which opening the hit scrolls to; null for a title match. */
  messageId: string | null;
  updatedAt: number;
}

/** The user's words as an FTS5 query: each token quoted (no operators leak in) and prefix-matched. */
export function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => `"${t.replace(/"/g, '""')}"*`)
    .join(" ");
}

/**
 * D19/#60: SQLite's FTS5 index over the messages' text (kept by triggers, migration 0006) answers in
 * index time with a snippet built by SQLite; the query is bounded by LIMIT, so a keystroke never scans
 * a user's whole history. Titles are matched separately with a case fold beyond ASCII.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const user = await requireUser();
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
    if (q.length < 2) return Response.json({ hits: [] }, { headers: { "cache-control": "no-store" } });
    const db = getDb();
    const match = ftsQuery(q);
    const rows = match
      ? db.all<{ chatId: string; messageId: string; title: string; updatedAt: number; snippet: string }>(sql`
          select c.id as chatId, m.id as messageId, c.title as title, c.updated_at as updatedAt,
                 snippet(messages_fts, 0, '', '', '…', 20) as snippet
          from messages_fts
          join messages m on m.rowid = messages_fts.rowid
          join chats c on c.id = m.chat_id
          where messages_fts match ${match} and c.user_id = ${user.id}
          order by c.updated_at desc, m.position asc
          limit 200`)
      : [];
    const needle = `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
    const titleRows = db.all<{ chatId: string; title: string; updatedAt: number }>(sql`
      select id as chatId, title as title, updated_at as updatedAt from chats
      where user_id = ${user.id} and unicode_lower(title) like ${needle} escape '\\'
      order by updated_at desc limit 20`);
    const byChat = new Map<string, SearchHit>();
    for (const r of rows) {
      if (!byChat.has(r.chatId)) byChat.set(r.chatId, { chatId: r.chatId, title: r.title, snippet: r.snippet.replace(/\s+/g, " ").trim(), messageId: r.messageId, updatedAt: r.updatedAt });
    }
    for (const r of titleRows) {
      if (!byChat.has(r.chatId)) byChat.set(r.chatId, { chatId: r.chatId, title: r.title, snippet: null, messageId: null, updatedAt: r.updatedAt });
    }
    const hits = [...byChat.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 20);
    return Response.json({ hits }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
