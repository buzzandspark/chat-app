import "server-only";
import { sql } from "drizzle-orm";
import { openDatabase, type DbHandle } from "@db/client";
import type { SearchHit } from "@shared/api";

const MAX_HITS = 20;
// The newest matches one search reads at most: about 10 ms even when they all sit in a few chats.
const MAX_SCANNED = 5000;

/**
 * The user's words as an FTS5 query over their own messages, each token quoted so no operators leak in. The last token
 * and any of two or three characters prefix-match: those prefixes are indexed, and a longer one costs a pass over every
 * user's matching terms, so earlier long words and single characters match whole words.
 */
export function ftsQuery(userId: string, q: string): string {
  const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
  const terms = tokens.map((t, i) => {
    const prefix = t.length >= 2 && (t.length <= 3 || i === tokens.length - 1);
    return `"${t.replace(/"/g, '""')}"${prefix ? "*" : ""}`;
  });
  return terms.length > 0 ? `search_owner:${Buffer.from(userId).toString("hex")} AND search_text:(${terms.join(" ")})` : "";
}

/**
 * SQLite's FTS5 index over message text, keyed by owner (kept by triggers), is read newest match first: the first
 * match per chat is that chat's hit, and the read stops at 20 chats or `MAX_SCANNED` matches. Snippets are built for
 * the hits only. Titles are matched separately with a case fold beyond ASCII.
 */
export function searchChats(userId: string, q: string, { db, sqlite }: DbHandle = openDatabase()): SearchHit[] {
  const match = ftsQuery(userId, q);
  const newestByChat = new Map<string, number>();
  if (match) {
    const matches = sqlite.prepare<[string, string], { chatId: string; rid: number }>(`
      select m.chat_id as chatId, f.rowid as rid
      from messages_fts f
      join messages m on m.rowid = f.rowid
      join chats c on c.id = m.chat_id
      where messages_fts match ? and c.user_id = ?
      order by f.rowid desc`);
    let scanned = 0;
    for (const r of matches.iterate(match, userId)) {
      if (!newestByChat.has(r.chatId)) newestByChat.set(r.chatId, r.rid);
      if (newestByChat.size >= MAX_HITS || ++scanned >= MAX_SCANNED) break;
    }
  }
  const rids = [...newestByChat.values()];
  // The rowid range is the index's to use; `+` keeps the IN list a filter, so the match is not re-run per row.
  const rows =
    rids.length > 0
      ? sqlite
          .prepare<[string, number, number, string, string], { chatId: string; messageId: string; title: string; updatedAt: number; snippet: string }>(`
            select c.id as chatId, m.id as messageId, c.title as title, c.updated_at as updatedAt,
                   snippet(messages_fts, 0, '', '', '…', 20) as snippet
            from messages_fts f
            join messages m on m.rowid = f.rowid
            join chats c on c.id = m.chat_id
            where messages_fts match ? and f.rowid between ? and ? and +f.rowid in (select value from json_each(?))
              and c.user_id = ?`)
          .all(match, Math.min(...rids), Math.max(...rids), JSON.stringify(rids), userId)
      : [];
  const needle = `%${q.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
  const titleRows = db.all<{ chatId: string; title: string; updatedAt: number }>(sql`
    select id as chatId, title as title, updated_at as updatedAt from chats
    where user_id = ${userId} and unicode_lower(title) like ${needle} escape '\\'
    order by updated_at desc limit ${MAX_HITS}`);
  const byChat = new Map<string, SearchHit>();
  for (const r of rows) {
    byChat.set(r.chatId, { chatId: r.chatId, title: r.title, snippet: r.snippet.replace(/\s+/g, " ").trim(), messageId: r.messageId, updatedAt: r.updatedAt });
  }
  for (const r of titleRows) {
    if (!byChat.has(r.chatId)) byChat.set(r.chatId, { chatId: r.chatId, title: r.title, snippet: null, messageId: null, updatedAt: r.updatedAt });
  }
  return [...byChat.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_HITS);
}
