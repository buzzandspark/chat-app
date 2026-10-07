import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@db/client";
import type { StoredContentBlock } from "@shared/blocks";
import type { MessageStatus, RefusalInfo, RelayError, Timings } from "@shared/types";

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
}

export interface MessageRow {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: StoredContentBlock[];
  status: MessageStatus;
  requestedModel: string | null;
  servingModel: string | null;
  stopReason: string | null;
  refusal: RefusalInfo | null;
  error: RelayError | null;
  timings: Timings | null;
  generationId: string | null;
  lastSeq: number | null;
  createdAt: number;
}

export function listChats(userId: string, limit = 200): ChatSummary[] {
  const db = getDb();
  return db
    .select({ id: schema.chats.id, title: schema.chats.title, updatedAt: schema.chats.updatedAt })
    .from(schema.chats)
    .where(eq(schema.chats.userId, userId))
    .orderBy(desc(schema.chats.updatedAt))
    .limit(limit)
    .all()
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt.getTime() }));
}

export function getChatWithMessages(chatId: string, userId: string): { chat: ChatSummary; messages: MessageRow[] } | null {
  const db = getDb();
  const chat = db
    .select()
    .from(schema.chats)
    .where(and(eq(schema.chats.id, chatId), eq(schema.chats.userId, userId)))
    .get();
  if (!chat) return null;
  const rows = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))
    .orderBy(asc(schema.messages.position))
    .all();
  return {
    chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt.getTime() },
    messages: rows.map((r) => ({
      id: r.id,
      chatId: r.chatId,
      role: r.role,
      content: r.content,
      status: r.status,
      requestedModel: r.requestedModel,
      servingModel: r.servingModel,
      stopReason: r.stopReason,
      refusal: r.refusal ?? null,
      error: r.error ?? null,
      timings: r.timings ?? null,
      generationId: r.generationId,
      lastSeq: r.lastSeq,
      createdAt: r.createdAt.getTime(),
    })),
  };
}
