import type { NextRequest } from "next/server";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@db/client";
import { errorResponse, requireUser } from "@server/current-user";

export interface SearchHit {
  chatId: string;
  title: string;
  snippet: string | null;
  updatedAt: number;
}

/**
 * D19: one process (D1) has no search service. SQLite does the scanning (`like` over the stored JSON,
 * in C) and only matching rows are parsed; before, every message of every chat was JSON-parsed in
 * JS on each keystroke, about 30 MB for a large history.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const user = await requireUser();
    const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100).toLowerCase();
    if (q.length < 2) return Response.json({ hits: [] }, { headers: { "cache-control": "no-store" } });
    const db = getDb();
    const chats = db
      .select({ id: schema.chats.id, title: schema.chats.title, updatedAt: schema.chats.updatedAt })
      .from(schema.chats)
      .where(eq(schema.chats.userId, user.id))
      .orderBy(desc(schema.chats.updatedAt))
      .limit(500)
      .all();
    if (chats.length === 0) return Response.json({ hits: [] }, { headers: { "cache-control": "no-store" } });
    const needle = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
    const rows = db
      .select({ chatId: schema.messages.chatId, content: schema.messages.content, position: schema.messages.position })
      .from(schema.messages)
      .where(and(inArray(schema.messages.chatId, chats.map((c) => c.id)), sql`unicode_lower(${schema.messages.content}) like ${needle} escape '\\'`))
      .orderBy(schema.messages.position)
      .all();
    const snippetByChat = new Map<string, string>();
    for (const r of rows) {
      if (snippetByChat.has(r.chatId)) continue;
      for (const b of r.content) {
        if (b.type !== "text") continue;
        const at = b.text.toLowerCase().indexOf(q);
        if (at === -1) continue;
        const start = Math.max(0, at - 40);
        snippetByChat.set(r.chatId, `${start > 0 ? "…" : ""}${b.text.slice(start, at + q.length + 80).replace(/\s+/g, " ").trim()}`);
        break;
      }
    }
    const hits: SearchHit[] = [];
    for (const c of chats) {
      const snippet = snippetByChat.get(c.id) ?? null;
      if (snippet === null && !c.title.toLowerCase().includes(q)) continue;
      hits.push({ chatId: c.id, title: c.title, snippet, updatedAt: c.updatedAt.getTime() });
      if (hits.length >= 20) break;
    }
    return Response.json({ hits }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
