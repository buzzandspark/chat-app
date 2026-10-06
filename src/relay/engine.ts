import { asc, eq, max } from "drizzle-orm";
import type { Db } from "@db/client";
import { chats, generations, messages, usageEvents } from "@db/schema";
import { uuidv7 } from "@shared/id";
import type { StoredContentBlock } from "@shared/blocks";
import type {
  GenerationStatus,
  InterruptedReason,
  MessageStatus,
  ModelId,
  RelayError,
  ThinkingOptions,
  UserRole,
} from "@shared/types";
import { toContentBlocks } from "./anthropic/accumulate";
import { isAbortError, toRelayError } from "./anthropic/errors";
import type { HistoryMessage } from "./anthropic/history";
import {
  createAccumulator,
  hadDeclinedAttempt,
  normalizeEvent,
  resolveServingModel,
  type StreamAccumulator,
} from "./anthropic/parse-stream";
import { priceIterations, summarize, type UsageRow } from "./anthropic/pricing";
import type { MessageSnapshot, RelayEvent, RelayEventBody, ServerTimings } from "./events";
import { ProviderStatusError } from "./providers/replay";
import type { Provider } from "./providers/types";
import { QuotaManager } from "./quota";
import type { EventStore } from "./store";
import { TpsStats } from "./tps";

export class DrainingError extends Error {
  constructor() {
    super("The server is restarting; try again in a moment");
    this.name = "DrainingError";
  }
}
export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export interface ProviderContext {
  userId: string;
  userRole: UserRole;
  model: ModelId;
  scenario?: string;
}
export type ProviderResolver = (ctx: ProviderContext) => Provider;

export interface EngineFaults {
  /** D24 producer restart: abort this generation after N relayed events and emit `interrupted`. */
  interruptAfterEvents?: number;
}

export interface EngineOptions {
  db: Db;
  store: EventStore;
  providers: ProviderResolver;
  quota?: QuotaManager;
  tps?: TpsStats;
  now?: () => number;
  /** D3: partial content is written this often while streaming. */
  partialPersistMs?: number;
  isDraining?: () => boolean;
}

export interface StartInput {
  generationId: string;
  chatId: string;
  userId: string;
  userRole: UserRole;
  userMessageId: string;
  assistantMessageId: string;
  /** Omitted when retrying: the user message already exists. */
  text?: string;
  model: ModelId;
  thinking: ThinkingOptions;
  scenario?: string;
  faults?: EngineFaults;
}

export type StartOutcome = { created: true } | { created: false; reason: "exists" };

export type ResumeOutcome =
  | { kind: "live" }
  | { kind: "snapshot"; event: RelayEvent }
  | { kind: "not_found" };

type AbortReason = "stop" | "shutdown" | "scenario";

interface Active {
  id: string;
  chatId: string;
  userId: string;
  messageId: string;
  requestedModel: ModelId;
  controller: AbortController;
  abortReason: AbortReason | null;
  acc: StreamAccumulator;
  startedAt: number;
  firstTokenAt: number | null;
  firstRelayedAt: number | null;
  relayed: number;
  partialTimer: ReturnType<typeof setInterval> | null;
  promise: Promise<void>;
  faults: EngineFaults;
}

/**
 * The relay engine (D2 to D5, D22). Route handlers call `start`, `resume`,
 * and `stop`; a generation runs as a detached promise that outlives the HTTP
 * response (D1). No framework imports: tests drive it directly.
 */
export class Engine {
  private db: Db;
  private store: EventStore;
  private providers: ProviderResolver;
  private quota: QuotaManager;
  private tps: TpsStats;
  private now: () => number;
  private partialPersistMs: number;
  private isDraining: () => boolean;
  private active = new Map<string, Active>();

  constructor(options: EngineOptions) {
    this.db = options.db;
    this.store = options.store;
    this.providers = options.providers;
    this.quota = options.quota ?? new QuotaManager(options.db);
    this.tps = options.tps ?? new TpsStats();
    this.now = options.now ?? Date.now;
    this.partialPersistMs = options.partialPersistMs ?? 2000;
    this.isDraining = options.isDraining ?? (() => false);
  }

  /** Idempotent on `generationId` (D2): a duplicate returns `created: false`. */
  start(input: StartInput): StartOutcome {
    if (this.store.has(input.generationId)) return { created: false, reason: "exists" };
    const existingRow = this.db
      .select({ id: generations.id })
      .from(generations)
      .where(eq(generations.id, input.generationId))
      .get();
    if (existingRow) return { created: false, reason: "exists" };
    if (this.isDraining()) throw new DrainingError();

    const chatText = input.text ?? "";
    this.quota.reserve(
      input.userId,
      input.generationId,
      input.model,
      QuotaManager.estimateInputTokens(this.chatChars(input.chatId) + chatText.length),
    );

    const now = new Date(this.now());
    try {
      this.db.transaction((tx) => {
        const chat = tx.select().from(chats).where(eq(chats.id, input.chatId)).get();
        if (chat && chat.userId !== input.userId) throw new ForbiddenError("Not your chat");
        if (!chat) {
          tx.insert(chats)
            .values({
              id: input.chatId,
              userId: input.userId,
              title: titleFrom(chatText),
              createdAt: now,
              updatedAt: now,
              lastMessageAt: now,
            })
            .run();
        } else {
          tx.update(chats)
            .set({
              updatedAt: now,
              lastMessageAt: now,
              ...(chat.title === "New chat" && chatText ? { title: titleFrom(chatText) } : {}),
            })
            .where(eq(chats.id, input.chatId))
            .run();
        }
        const last = tx
          .select({ position: max(messages.position) })
          .from(messages)
          .where(eq(messages.chatId, input.chatId))
          .get();
        let position = (last?.position ?? -1) + 1;
        const userRow = tx
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.id, input.userMessageId))
          .get();
        if (!userRow) {
          if (input.text === undefined) throw new Error("retry without an existing user message");
          tx.insert(messages)
            .values({
              id: input.userMessageId,
              chatId: input.chatId,
              role: "user",
              position: position++,
              content: [{ type: "text", text: input.text, citations: null }],
              status: "done",
              createdAt: now,
              updatedAt: now,
            })
            .run();
        }
        tx.insert(messages)
          .values({
            id: input.assistantMessageId,
            chatId: input.chatId,
            role: "assistant",
            position,
            content: [],
            status: "streaming",
            requestedModel: input.model,
            generationId: input.generationId,
            timings: { server: { received: this.now() } },
            createdAt: now,
            updatedAt: now,
          })
          .run();
        tx.insert(generations)
          .values({
            id: input.generationId,
            chatId: input.chatId,
            userId: input.userId,
            messageId: input.assistantMessageId,
            userMessageId: input.userMessageId,
            status: "running",
            requestedModel: input.model,
            provider: this.providers({
              userId: input.userId,
              userRole: input.userRole,
              model: input.model,
              scenario: input.scenario,
            }).name,
            scenario: input.scenario ?? null,
            startedAt: now,
          })
          .run();
      });
    } catch (err) {
      this.quota.release(input.userId, input.generationId);
      throw err;
    }

    this.store.open(input.generationId);
    const active: Active = {
      id: input.generationId,
      chatId: input.chatId,
      userId: input.userId,
      messageId: input.assistantMessageId,
      requestedModel: input.model,
      controller: new AbortController(),
      abortReason: null,
      acc: createAccumulator(),
      startedAt: this.now(),
      firstTokenAt: null,
      firstRelayedAt: null,
      relayed: 0,
      partialTimer: null,
      promise: Promise.resolve(),
      faults: input.faults ?? {},
    };
    this.active.set(active.id, active);
    this.append(active, {
      type: "started",
      chatId: input.chatId,
      messageId: input.assistantMessageId,
      userMessageId: input.userMessageId,
      requestedModel: input.model,
    });
    active.promise = this.run(active, input).catch((err) => {
      console.error(`[engine] generation ${active.id} crashed`, err);
    });
    return { created: true };
  }

  /** D5: aborts upstream and appends `stopped`. Returns false if not running here. */
  stop(generationId: string): boolean {
    const active = this.active.get(generationId);
    if (!active || active.abortReason) return false;
    active.abortReason = "stop";
    active.controller.abort(new DOMException("stop", "AbortError"));
    return true;
  }

  /** D2 resume branches. The caller subscribes via `store` when `live`. */
  resume(generationId: string, userId: string | null): ResumeOutcome {
    if (this.store.has(generationId)) return { kind: "live" };
    const row = this.db.select().from(generations).where(eq(generations.id, generationId)).get();
    if (!row) return { kind: "not_found" };
    if (userId !== null && row.userId !== userId) throw new ForbiddenError();
    if (row.status === "running") {
      // The process restarted while this was running: nothing can finish it.
      this.markInterrupted(row.id, row.messageId, "crash");
    }
    const message = this.db.select().from(messages).where(eq(messages.id, row.messageId)).get();
    if (!message) return { kind: "not_found" };
    const snapshot: MessageSnapshot = {
      id: message.id,
      chatId: message.chatId,
      role: "assistant",
      content: message.content,
      status: message.status,
      requestedModel: message.requestedModel,
      servingModel: message.servingModel,
      stopReason: message.stopReason,
      refusal: message.refusal ?? null,
      error: message.error ?? null,
      timings: message.timings ?? null,
      generationId: message.generationId,
    };
    return {
      kind: "snapshot",
      event: { type: "snapshot", seq: null, generationId, t: 0, status: message.status, message: snapshot },
    };
  }

  owner(generationId: string): string | null {
    const active = this.active.get(generationId);
    if (active) return active.userId;
    const row = this.db
      .select({ userId: generations.userId })
      .from(generations)
      .where(eq(generations.id, generationId))
      .get();
    return row?.userId ?? null;
  }

  runningCount(): number {
    return this.active.size;
  }

  /** D3 shutdown: abort every upstream request and wait for each to settle. */
  async drain(): Promise<void> {
    const all = [...this.active.values()];
    for (const active of all) {
      if (!active.abortReason) {
        active.abortReason = "shutdown";
        active.controller.abort(new DOMException("shutdown", "AbortError"));
      }
    }
    await Promise.allSettled(all.map((a) => a.promise));
  }

  private async run(active: Active, input: StartInput): Promise<void> {
    const timings: ServerTimings = { received: active.startedAt };
    let provider: Provider | null = null;
    try {
      const history = this.loadHistory(active.chatId, active.messageId);
      provider = this.providers({
        userId: input.userId,
        userRole: input.userRole,
        model: input.model,
        scenario: input.scenario,
      });
      active.partialTimer = setInterval(() => this.persistPartial(active), this.partialPersistMs);
      active.partialTimer.unref?.();

      const stream = provider.stream(
        { model: input.model, thinking: input.thinking, messages: history, userId: input.userId, scenario: input.scenario },
        { signal: active.controller.signal },
      );
      for await (const raw of stream) {
        if (active.controller.signal.aborted) break;
        const bodies = normalizeEvent(raw, active.acc);
        for (const body of bodies) {
          if ((body.type === "text_delta" || body.type === "thinking_delta") && active.firstTokenAt === null) {
            active.firstTokenAt = this.now();
            timings.upstreamFirstToken = active.firstTokenAt;
          }
          if (body.type === "error") {
            this.finishError(active, body.error, timings);
            return;
          }
          this.append(active, body);
          if ((body.type === "text_delta" || body.type === "thinking_delta") && active.firstRelayedAt === null) {
            active.firstRelayedAt = this.now();
            timings.firstRelayed = active.firstRelayedAt;
          }
          if (
            active.faults.interruptAfterEvents !== undefined &&
            active.relayed >= active.faults.interruptAfterEvents &&
            !active.abortReason
          ) {
            active.abortReason = "scenario";
            active.controller.abort(new DOMException("scenario", "AbortError"));
          }
        }
        if (active.controller.signal.aborted) break;
      }

      if (active.controller.signal.aborted) {
        this.finishAborted(active, active.abortReason ?? "stop", timings);
        return;
      }
      if (!active.acc.messageStopped && active.acc.stopReason === null) {
        // The upstream stream ended without a terminal frame: connection lost.
        this.finishInterrupted(active, "upstream", timings, "The connection to the model dropped");
        return;
      }
      this.finishDone(active, timings);
    } catch (err) {
      if (active.controller.signal.aborted || isAbortError(err)) {
        this.finishAborted(active, active.abortReason ?? "stop", timings);
        return;
      }
      const error = err instanceof ProviderStatusError ? statusErrorToRelay(err) : toRelayError(err);
      if (error.kind === "network" && active.acc.apiMessageId) {
        this.finishInterrupted(active, "upstream", timings, error.message);
        return;
      }
      this.finishError(active, error, timings);
    }
  }

  private append(active: Active, body: RelayEventBody): void {
    this.store.append(active.id, body);
    active.relayed++;
  }

  private cleanup(active: Active): void {
    if (active.partialTimer) clearInterval(active.partialTimer);
    active.partialTimer = null;
    this.active.delete(active.id);
  }

  private persistPartial(active: Active): void {
    const content = toContentBlocks(active.acc);
    this.db
      .update(messages)
      .set({
        content,
        servingModel: resolveServingModel(active.acc),
        updatedAt: new Date(this.now()),
      })
      .where(eq(messages.id, active.messageId))
      .run();
  }

  private finishDone(active: Active, timings: ServerTimings): void {
    const acc = active.acc;
    const servingModel = resolveServingModel(acc) ?? active.requestedModel;
    timings.done = this.now();
    timings.declinedAttempt = hadDeclinedAttempt(acc);
    const rows = this.priceFinal(active, servingModel);
    const usage = summarize(rows, false);
    const refused = acc.stopReason === "refusal";
    const status: MessageStatus = refused ? "refused" : "done";
    const content = toContentBlocks(acc);
    this.finalize(active, {
      content,
      status,
      generationStatus: "done",
      servingModel,
      stopReason: acc.stopReason,
      timings,
      rows,
    });
    if (active.firstTokenAt !== null && !refused) {
      this.tps.record(servingModel, usage.outputTokens, timings.done - active.firstTokenAt);
    }
    this.append(active, { type: "done", stopReason: acc.stopReason, servingModel, usage, timings });
    this.cleanup(active);
  }

  private finishAborted(active: Active, reason: AbortReason, timings: ServerTimings): void {
    if (reason === "stop") {
      const servingModel = resolveServingModel(active.acc);
      timings.done = this.now();
      const rows = this.estimateRows(active, servingModel ?? active.requestedModel);
      const usage = rows.length ? summarize(rows, true) : null;
      this.finalize(active, {
        content: toContentBlocks(active.acc),
        status: "stopped",
        generationStatus: "stopped",
        servingModel,
        stopReason: null,
        timings,
        rows,
      });
      this.append(active, { type: "stopped", servingModel, usage });
      this.cleanup(active);
      return;
    }
    this.finishInterrupted(active, reason === "shutdown" ? "shutdown" : "crash", timings);
  }

  private finishInterrupted(active: Active, reason: InterruptedReason, timings: ServerTimings, message?: string): void {
    const servingModel = resolveServingModel(active.acc);
    timings.done = this.now();
    const rows = this.estimateRows(active, servingModel ?? active.requestedModel);
    this.finalize(active, {
      content: toContentBlocks(active.acc),
      status: "interrupted",
      generationStatus: "interrupted",
      interruptedReason: reason,
      servingModel,
      stopReason: null,
      timings,
      rows,
    });
    this.append(active, { type: "interrupted", reason, message });
    this.cleanup(active);
  }

  private finishError(active: Active, error: RelayError, timings: ServerTimings): void {
    const servingModel = resolveServingModel(active.acc);
    timings.done = this.now();
    const rows = active.acc.apiMessageId ? this.estimateRows(active, servingModel ?? active.requestedModel) : [];
    this.finalize(active, {
      content: toContentBlocks(active.acc),
      status: "error",
      generationStatus: "error",
      servingModel,
      stopReason: null,
      timings,
      rows,
      error,
    });
    this.append(active, { type: "error", error });
    this.cleanup(active);
  }

  private priceFinal(active: Active, servingModel: string): UsageRow[] {
    const u = active.acc.usage;
    if (u.iterations && u.iterations.length > 0) return priceIterations(u.iterations, servingModel);
    return priceIterations(
      [
        {
          type: "message",
          model: servingModel,
          input_tokens: u.inputTokens,
          output_tokens: u.outputTokens,
          cache_read_input_tokens: u.cacheReadTokens,
          cache_creation_input_tokens: u.cacheWriteTokens,
          cache_creation: null,
        },
      ],
      servingModel,
    );
  }

  /**
   * D22: without final usage, input tokens are exact from `message_start` and
   * output tokens are elapsed streaming time times the model's measured
   * tokens-per-second, because billed output includes full thinking while
   * only its summary is visible.
   */
  private estimateRows(active: Active, servingModel: string): UsageRow[] {
    const u = active.acc.usage;
    if (!active.acc.apiMessageId) return [];
    const from = active.firstTokenAt ?? active.startedAt;
    const outputTokens = this.tps.estimateOutputTokens(servingModel, this.now() - from);
    return priceIterations(
      [
        {
          type: "message",
          model: servingModel,
          input_tokens: u.inputTokens,
          output_tokens: outputTokens,
          cache_read_input_tokens: u.cacheReadTokens,
          cache_creation_input_tokens: u.cacheWriteTokens,
          cache_creation: null,
        },
      ],
      servingModel,
    );
  }

  private finalize(
    active: Active,
    final: {
      content: StoredContentBlock[];
      status: MessageStatus;
      generationStatus: GenerationStatus;
      interruptedReason?: InterruptedReason;
      servingModel: string | null;
      stopReason: string | null;
      timings: ServerTimings;
      rows: UsageRow[];
      error?: RelayError;
    },
  ): void {
    const now = new Date(this.now());
    const estimated = final.generationStatus !== "done";
    const cost = final.rows.reduce((s, r) => s + r.costUsd, 0);
    this.db.transaction((tx) => {
      tx.update(messages)
        .set({
          content: final.content,
          status: final.status,
          servingModel: final.servingModel,
          stopReason: final.stopReason,
          refusal: active.acc.refusal,
          error: final.error ?? null,
          timings: { server: final.timings },
          updatedAt: now,
        })
        .where(eq(messages.id, active.messageId))
        .run();
      tx.update(generations)
        .set({
          status: final.generationStatus,
          interruptedReason: final.interruptedReason ?? null,
          servingModel: final.servingModel,
          stopReason: final.stopReason,
          iterations: active.acc.usage.iterations,
          error: final.error ?? null,
          endedAt: now,
        })
        .where(eq(generations.id, active.id))
        .run();
      for (const row of final.rows) {
        tx.insert(usageEvents)
          .values({
            id: uuidv7(),
            generationId: active.id,
            userId: active.userId,
            model: row.model,
            iterationType: row.iterationType,
            inputTokens: row.inputTokens,
            outputTokens: row.outputTokens,
            cacheReadTokens: row.cacheReadTokens,
            cacheWriteTokens: row.cacheWriteTokens,
            costUsd: row.costUsd,
            estimated,
            createdAt: now,
          })
          .run();
      }
      tx.update(chats).set({ updatedAt: now, lastMessageAt: now }).where(eq(chats.id, active.chatId)).run();
    });
    this.quota.settle(active.userId, active.id, cost);
  }

  private markInterrupted(generationId: string, messageId: string, reason: InterruptedReason): void {
    const now = new Date(this.now());
    this.db.transaction((tx) => {
      tx.update(generations)
        .set({ status: "interrupted", interruptedReason: reason, endedAt: now })
        .where(eq(generations.id, generationId))
        .run();
      tx.update(messages)
        .set({ status: "interrupted", updatedAt: now })
        .where(eq(messages.id, messageId))
        .run();
    });
  }

  private loadHistory(chatId: string, assistantMessageId: string): HistoryMessage[] {
    const target = this.db
      .select({ position: messages.position })
      .from(messages)
      .where(eq(messages.id, assistantMessageId))
      .get();
    const rows = this.db
      .select({ role: messages.role, content: messages.content, status: messages.status, position: messages.position })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(asc(messages.position))
      .all();
    const cutoff = target?.position ?? Number.MAX_SAFE_INTEGER;
    return rows.filter((r) => r.position < cutoff).map((r) => ({ role: r.role, content: r.content, status: r.status }));
  }

  private chatChars(chatId: string): number {
    const rows = this.db
      .select({ content: messages.content })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .all();
    let n = 0;
    for (const r of rows) for (const b of r.content) if (b.type === "text") n += b.text.length;
    return n;
  }
}

function titleFrom(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";
  if (!line) return "New chat";
  return line.length > 60 ? `${line.slice(0, 57).trimEnd()}…` : line;
}

function statusErrorToRelay(err: ProviderStatusError): RelayError {
  switch (err.status) {
    case 429:
      return {
        kind: "rate_limited",
        message: err.message,
        retryable: true,
        retryAfterMs: (err.retryAfter ?? 15) * 1000,
        status: 429,
      };
    case 529:
      return { kind: "overloaded", message: err.message, retryable: true, retryAfterMs: 10_000, status: 529 };
    case 401:
    case 403:
      return { kind: "auth", message: err.message, retryable: false, status: err.status };
    case 400:
      if (/too long|context/i.test(err.message)) {
        return { kind: "context_full", message: "This chat is too long to continue", retryable: false, status: 400 };
      }
      return { kind: "bad_request", message: err.message, retryable: false, status: 400 };
    default:
      return { kind: "api_error", message: err.message, retryable: err.status >= 500, status: err.status };
  }
}

