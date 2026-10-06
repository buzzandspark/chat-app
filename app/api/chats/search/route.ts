import type { NextRequest } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@db/client";
import { errorResponse, requireUser } from "@server/current-user";

export interface SearchHit {
  chatId: string;
  title: string;
  snippet: string | null;
  updatedAt: number;
}

/**
 * D19 search (⌘/Ctrl+K): titles and message text, newest first. One process
 * (D1) has no search service, so this scans the user's own chats in SQLite
 * and matches text blocks in JavaScript; a personal history is small enough
 * that this stays well under a frame at a few thousand messages.
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
    const rows = db
      .select({ chatId: schema.messages.chatId, content: schema.messages.content, position: schema.messages.position })
      .from(schema.messages)
      .where(inArray(schema.messages.chatId, chats.map((c) => c.id)))
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
