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
  /** From the message's generation; a reply from a scripted scenario keeps it through Continue and retries. */
  scenario: string | null;
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

/** The newest messages the page ships; the rest load on request (#47). */
export const SEED_WINDOW = 100;

/** Thinking signatures and redacted payloads never leave the server: the client has no use for them (#47). */
function stripForClient(content: StoredContentBlock[]): StoredContentBlock[] {
  return content.map((b) => {
    if (b.type === "thinking") return { ...b, signature: "" };
    if (b.type === "redacted_thinking") return { ...b, data: "" };
    return b;
  });
}

export function getChatWithMessages(
  chatId: string,
  userId: string,
  options: { limit?: number | null } = {},
): { chat: ChatSummary; messages: MessageRow[]; older: number } | null {
  const db = getDb();
  const chat = db
    .select()
    .from(schema.chats)
    .where(and(eq(schema.chats.id, chatId), eq(schema.chats.userId, userId)))
    .get();
  if (!chat) return null;
  const limit = options.limit === undefined ? SEED_WINDOW : options.limit;
  const all = db
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.chatId, chatId))
    .orderBy(asc(schema.messages.position))
    .all();
  const rows = limit === null || all.length <= limit ? all : all.slice(all.length - limit);
  const older = all.length - rows.length;
  const scenarios = new Map(
    db
      .select({ id: schema.generations.id, scenario: schema.generations.scenario })
      .from(schema.generations)
      .where(eq(schema.generations.chatId, chatId))
      .all()
      .map((g) => [g.id, g.scenario] as const),
  );
  return {
    chat: { id: chat.id, title: chat.title, updatedAt: chat.updatedAt.getTime() },
    older,
    messages: rows.map((r) => ({
      id: r.id,
      chatId: r.chatId,
      role: r.role,
      content: stripForClient(r.content),
      status: r.status,
      requestedModel: r.requestedModel,
      servingModel: r.servingModel,
      stopReason: r.stopReason,
      refusal: r.refusal ?? null,
      error: r.error ?? null,
      timings: r.timings ?? null,
      generationId: r.generationId,
      lastSeq: r.lastSeq,
      scenario: (r.generationId && scenarios.get(r.generationId)) || null,
      createdAt: r.createdAt.getTime(),
    })),
  };
}
