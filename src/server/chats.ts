import "server-only";
import { and, asc, desc, eq, gte } from "drizzle-orm";
import { getDb, schema, type Db } from "@db/client";
import type { StoredContentBlock } from "@shared/blocks";
import type { ForkOption } from "@shared/forks";
import { normalizeThinking } from "@shared/models";
import type { MessageStatus, RefusalInfo, RelayError, ThinkingOptions } from "@shared/types";

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  pinned: boolean;
  forkedFrom: string | null;
  forkOrder: number | null;
  tabHidden: boolean;
}

export type ChatDetail = ChatSummary & { forkPosition: number | null };

export interface MessageRow {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  position: number;
  content: StoredContentBlock[];
  status: MessageStatus;
  requestedModel: string | null;
  servingModel: string | null;
  stopReason: string | null;
  refusal: RefusalInfo | null;
  error: RelayError | null;
  thinking: ThinkingOptions | null;
  options: ForkOption[] | null;
  generationId: string | null;
  lastSeq: number | null;
  /** From the message's generation; a reply from a scripted scenario keeps it through Continue and retries. */
  scenario: string | null;
  createdAt: number;
}

export function listChats(userId: string, limit = 200): ChatSummary[] {
  const db = getDb();
  return db
    .select({
      id: schema.chats.id,
      title: schema.chats.title,
      updatedAt: schema.chats.updatedAt,
      pinned: schema.chats.pinned,
      forkedFrom: schema.chats.forkedFrom,
      forkOrder: schema.chats.forkOrder,
      tabHidden: schema.chats.tabHidden,
    })
    .from(schema.chats)
    .where(eq(schema.chats.userId, userId))
    .orderBy(desc(schema.chats.updatedAt))
    .limit(limit)
    .all()
    .map((c) => ({ ...c, updatedAt: c.updatedAt.getTime() }));
}

/** The newest messages the page ships; the rest load on request. */
const SEED_WINDOW = 100;

/** Thinking signatures and redacted payloads never leave the server: the client has no use for them. */
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
): { chat: ChatDetail; messages: MessageRow[]; older: number } | null {
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
    chat: {
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt.getTime(),
      pinned: chat.pinned,
      forkedFrom: chat.forkedFrom,
      forkOrder: chat.forkOrder,
      tabHidden: chat.tabHidden,
      forkPosition: chat.forkPosition,
    },
    older,
    messages: rows.map((r) => ({
      id: r.id,
      chatId: r.chatId,
      role: r.role,
      position: r.position,
      content: stripForClient(r.content),
      status: r.status,
      requestedModel: r.requestedModel,
      servingModel: r.servingModel,
      stopReason: r.stopReason,
      refusal: r.refusal ?? null,
      error: r.error ?? null,
      thinking: r.thinking == null ? null : normalizeThinking(r.thinking),
      options: r.forkOptions ?? null,
      generationId: r.generationId,
      lastSeq: r.lastSeq,
      scenario: (r.generationId && scenarios.get(r.generationId)) || null,
      createdAt: r.createdAt.getTime(),
    })),
  };
}

export interface ChatPatch {
  title?: string;
  pinned?: boolean;
  tabHidden?: boolean;
}

/** False when the chat is not the user's. */
export function updateChat(userId: string, chatId: string, patch: ChatPatch, db: Db = getDb()): boolean {
  return (
    db
      .update(schema.chats)
      .set(patch)
      .where(and(eq(schema.chats.id, chatId), eq(schema.chats.userId, userId)))
      .run().changes > 0
  );
}

export function ownsChat(userId: string, chatId: string, db: Db = getDb()): boolean {
  return !!db
    .select({ id: schema.chats.id })
    .from(schema.chats)
    .where(and(eq(schema.chats.id, chatId), eq(schema.chats.userId, userId)))
    .get();
}

/** Messages, generations and usage rows cascade; stop the chat's running generations first. */
export function deleteChat(userId: string, chatId: string, db: Db = getDb()): boolean {
  return db
    .delete(schema.chats)
    .where(and(eq(schema.chats.id, chatId), eq(schema.chats.userId, userId)))
    .run().changes > 0;
}

/** Generations of the turns an Edit or Regenerate from `fromMessageId` would drop; empty if the message is not the user's. */
export function replacedGenerationIds(userId: string, chatId: string, fromMessageId: string, db: Db = getDb()): string[] {
  const from = db
    .select({ position: schema.messages.position })
    .from(schema.messages)
    .innerJoin(schema.chats, eq(schema.chats.id, schema.messages.chatId))
    .where(and(eq(schema.messages.id, fromMessageId), eq(schema.messages.chatId, chatId), eq(schema.chats.userId, userId)))
    .get();
  if (!from) return [];
  return db
    .select({ generationId: schema.messages.generationId })
    .from(schema.messages)
    .where(and(eq(schema.messages.chatId, chatId), gte(schema.messages.position, from.position)))
    .all()
    .flatMap((r) => (r.generationId ? [r.generationId] : []));
}
