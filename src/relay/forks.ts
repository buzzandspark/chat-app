import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@db/client";
import { chats, generations, messages } from "@db/schema";
import { MAX_FORKS } from "@shared/forks";
import { uuidv7 } from "@shared/id";
import { DEFAULT_MODEL, isModelId } from "@shared/models";
import type { ThinkingOptions, UserRole } from "@shared/types";
import type { Engine, RetryPolicy } from "./engine";
import { isTerminal } from "./events";
import type { EventStore } from "./store";

export interface ForkRequest {
  chatId: string;
  generationId: string;
  userMessageId: string;
  assistantMessageId: string;
  title: string;
  prompt: string;
}

export interface CreateForksInput {
  userId: string;
  userRole: UserRole;
  parentId: string;
  forks: ForkRequest[];
}

export interface StartedFork {
  chatId: string;
  generationId: string;
  assistantMessageId: string;
}

export type ForkRefusal = "not_found" | "is_fork" | "too_many";

export class ForkError extends Error {
  constructor(public code: ForkRefusal) {
    super(code);
    this.name = "ForkError";
  }
}

/** A fork after the first failed to start: the ones before it run; its own rows are gone. */
export class ForkStartError extends Error {
  constructor(
    public reason: unknown,
    public started: StartedFork[],
  ) {
    super("fork start failed");
    this.name = "ForkStartError";
  }
}

export const FORK_RETRY: RetryPolicy = { attempts: 3, baseMs: 1000 };
/** Forks after the first wait this long at most for its cache entry to be written. */
export const FORK_GATE_MS = 10_000;

export interface ForkDeps {
  db: Db;
  engine: Engine;
  store: EventStore;
  now?: () => number;
  gateMs?: number;
}

/**
 * Each fork copies every parent row, then asks the parent's model, at the parent's effort, the
 * prompt as its first own turn. Fork 1 goes first alone so its request writes the cache entry
 * for the parent's final reply; the rest start once the API has begun that message.
 */
export function createForks(deps: ForkDeps, input: CreateForksInput): StartedFork[] {
  const { db, engine, store } = deps;
  const now = new Date(deps.now?.() ?? Date.now());
  const parent = db.select().from(chats).where(and(eq(chats.id, input.parentId), eq(chats.userId, input.userId))).get();
  if (!parent) throw new ForkError("not_found");
  if (parent.forkedFrom) throw new ForkError("is_fork");
  const existing = db.select({ id: chats.id }).from(chats).where(eq(chats.forkedFrom, parent.id)).all().length;
  if (existing + input.forks.length > MAX_FORKS) throw new ForkError("too_many");

  const rows = db.select().from(messages).where(eq(messages.chatId, parent.id)).orderBy(asc(messages.position)).all();
  const lastReply = [...rows].reverse().find((r) => r.role === "assistant");
  const model = isModelId(lastReply?.requestedModel) ? lastReply.requestedModel : DEFAULT_MODEL;
  const thinking: ThinkingOptions = lastReply?.thinking ?? { harder: false };
  const lastGeneration = lastReply?.generationId
    ? db.select({ scenario: generations.scenario }).from(generations).where(eq(generations.id, lastReply.generationId)).get()
    : undefined;
  // A scenario reply forks as a scripted reply too: never a live prompt out of a script (D22).
  const scenario = lastGeneration?.scenario ? "normal" : undefined;
  const forkPosition = (rows.at(-1)?.position ?? -1) + 1;

  const started: StartedFork[] = [];
  let gate: Promise<void> | undefined;
  input.forks.forEach((fork, i) => {
    db.transaction((tx) => {
      tx.insert(chats)
        .values({
          id: fork.chatId,
          userId: input.userId,
          title: fork.title,
          forkedFrom: parent.id,
          forkPosition,
          forkOrder: existing + i,
          createdAt: now,
          updatedAt: now,
          lastMessageAt: now,
        })
        .run();
      for (const r of rows) {
        tx.insert(messages)
          .values({
            id: uuidv7(),
            chatId: fork.chatId,
            role: r.role,
            position: r.position,
            content: r.content,
            status: r.status,
            requestedModel: r.requestedModel,
            servingModel: r.servingModel,
            stopReason: r.stopReason,
            refusal: r.refusal,
            error: r.error,
            thinking: r.thinking,
            createdAt: r.createdAt,
            updatedAt: now,
          })
          .run();
      }
    });
    try {
      engine.start({
        generationId: fork.generationId,
        chatId: fork.chatId,
        userId: input.userId,
        userRole: input.userRole,
        userMessageId: fork.userMessageId,
        assistantMessageId: fork.assistantMessageId,
        text: fork.prompt,
        model,
        thinking,
        scenario,
        cacheTail: true,
        retry: FORK_RETRY,
        gate,
      });
    } catch (err) {
      db.delete(chats).where(eq(chats.id, fork.chatId)).run();
      throw new ForkStartError(err, started);
    }
    started.push({ chatId: fork.chatId, generationId: fork.generationId, assistantMessageId: fork.assistantMessageId });
    if (i === 0) gate = upstreamBegun(store, fork.generationId, deps.gateMs ?? FORK_GATE_MS);
  });
  return started;
}

/** Resolves when the API has begun the generation's message, when it ends first, or after `ms`. */
function upstreamBegun(store: EventStore, generationId: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    let unsubscribe: (() => void) | null = null;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve();
    };
    const timer = setTimeout(finish, ms);
    unsubscribe = store.subscribe(generationId, -1, (event) => {
      if (event.type === "message_start" || isTerminal(event)) finish();
    });
    if (done || store.get(generationId)?.terminal) finish();
  });
}

/** Reorders a parent's forks; ids outside the parent are ignored, forks left out keep their place after the named ones. */
export function setForkOrder(db: Db, userId: string, parentId: string, ids: string[]): boolean {
  const owned = db.select({ id: chats.id }).from(chats).where(and(eq(chats.id, parentId), eq(chats.userId, userId))).get();
  if (!owned) return false;
  const forks = db
    .select({ id: chats.id, forkOrder: chats.forkOrder })
    .from(chats)
    .where(eq(chats.forkedFrom, parentId))
    .orderBy(asc(chats.forkOrder))
    .all();
  const known = new Set(forks.map((f) => f.id));
  const ordered = [...ids.filter((id) => known.has(id)), ...forks.map((f) => f.id).filter((id) => !ids.includes(id))];
  db.transaction((tx) => {
    ordered.forEach((id, index) => tx.update(chats).set({ forkOrder: index }).where(eq(chats.id, id)).run());
  });
  return true;
}
