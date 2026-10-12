import { and, asc, desc, eq, gte, inArray, max } from "drizzle-orm";
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
import { CONTEXT_FULL_RE, isAbortError, toRelayError } from "./anthropic/errors";
import type { HistoryMessage } from "./anthropic/history";
import {
  createAccumulator,
  hadDeclinedAttempt,
  normalizeEvent,
  resolveServingModel,
  type NormalizableEvent,
  type StreamAccumulator,
} from "./anthropic/parse-stream";
import { priceIterations, summarize, type UsageRow } from "./anthropic/pricing";
import type { MessageSnapshot, RelayEvent, RelayEventBody, ServerTimings } from "./events";
import { ProviderStatusError, sleep } from "./providers/replay";
import { isBillableProvider, type Provider, type ProviderRequest } from "./providers/types";
import { QuotaManager } from "./quota";
import type { EventStore } from "./store";
import { TpsStats } from "./tps";
import { settleOrphan } from "./orphans";

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

/** A reply that ended as `done`, for side effects that must never touch the reply itself. */
export interface ReplyDoneInfo {
  chatId: string;
  messageId: string;
  generationId: string;
  userId: string;
  scenario: string | null;
  billable: boolean;
  text: string;
}

export interface RetryPolicy {
  attempts: number;
  baseMs: number;
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
  /** D16: a generation whose upstream sends nothing for this long ends as `interrupted { reason: "upstream" }`. 0 disables. */
  upstreamIdleMs?: number;
  isDraining?: () => boolean;
  afterDone?: (info: ReplyDoneInfo) => void;
}

export interface StartInput {
  generationId: string;
  chatId: string;
  userId: string;
  userRole: UserRole;
  userMessageId: string;
  /** D10/#21: drop this message and everything after it in the same transaction that starts the new generation. */
  replaceFromMessageId?: string;
  assistantMessageId: string;
  /** Omitted when retrying: the user message already exists. */
  text?: string;
  model: ModelId;
  thinking: ThinkingOptions;
  scenario?: string;
  faults?: EngineFaults;
  /** Awaited before the upstream request; rows, buffer and `started` exist meanwhile, so a client can attach. */
  gate?: Promise<void>;
  /** Also cache the final assistant message, so forks that share it as a prefix read one entry (D13). */
  cacheTail?: boolean;
  /** Re-send a request that fails before the API begins a message, with exponential backoff. */
  retry?: RetryPolicy;
}

/**
 * `replace_running`: a turn the replace would drop still has a generation running here (the caller's
 * stop has not settled it, or another request started one meanwhile); nothing changed, try again.
 * `replace_gone`: `replaceFromMessageId` is no longer in the chat, so another request replaced it first.
 */
export type ReplaceConflict = "replace_running" | "replace_gone";
export type StartOutcome = { created: true } | { created: false; reason: "exists" | ReplaceConflict };

export type ResumeOutcome =
  | { kind: "live" }
  | { kind: "snapshot"; event: RelayEvent }
  | { kind: "not_found" };

type AbortReason = "stop" | "shutdown" | "scenario" | "idle" | "cap";

interface FinalState {
  content: StoredContentBlock[];
  status: MessageStatus;
  generationStatus: GenerationStatus;
  interruptedReason?: InterruptedReason;
  servingModel: string | null;
  stopReason: string | null;
  timings: ServerTimings;
  rows: UsageRow[];
  error?: RelayError;
  /** Override for the usage rows' `estimated` flag (a stop after the final usage frame is exact). */
  estimated?: boolean;
}

interface Active {
  id: string;
  chatId: string;
  userId: string;
  messageId: string;
  requestedModel: ModelId;
  scenario: string | null;
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
  /** False for scripted and replayed runs: no reservation, zero-cost usage rows, no TPS sample. */
  billable: boolean;
}

/** Relay engine (D2 to D5, D22): a generation runs as a detached promise that outlives the response. */
export class Engine {
  private db: Db;
  private store: EventStore;
  private providers: ProviderResolver;
  private quota: QuotaManager;
  private tps: TpsStats;
  private now: () => number;
  private partialPersistMs: number;
  private upstreamIdleMs: number;
  private isDraining: () => boolean;
  private afterDone: ((info: ReplyDoneInfo) => void) | null;
  private active = new Map<string, Active>();

  constructor(options: EngineOptions) {
    this.db = options.db;
    this.store = options.store;
    this.providers = options.providers;
    this.quota = options.quota ?? new QuotaManager(options.db);
    this.tps = options.tps ?? new TpsStats();
    this.now = options.now ?? Date.now;
    this.partialPersistMs = options.partialPersistMs ?? 2000;
    this.upstreamIdleMs = options.upstreamIdleMs ?? 60_000;
    this.isDraining = options.isDraining ?? (() => false);
    this.afterDone = options.afterDone ?? null;
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
    const userRowExists =
      this.db.select({ id: messages.id }).from(messages).where(eq(messages.id, input.userMessageId)).get() !== undefined;
    // A retry or regenerate with no scenario of its own keeps the scenario of the reply it replaces,
    // so "Scenario: …" never becomes a prompt for the live model.
    if (userRowExists && input.scenario === undefined) {
      const previous = this.db
        .select({ scenario: generations.scenario })
        .from(generations)
        .where(eq(generations.userMessageId, input.userMessageId))
        .orderBy(desc(generations.startedAt))
        .get();
      if (previous?.scenario) input = { ...input, scenario: previous.scenario };
    }
    const provider = this.providers({
      userId: input.userId,
      userRole: input.userRole,
      model: input.model,
      scenario: input.scenario,
    });
    const billable = isBillableProvider(provider.name);
    // A scripted or replayed run spends nothing, so it is neither metered against the cap nor refused by it.
    if (billable) {
      // A retry's text is already in the chat; count it once.
      this.quota.admit(
        input.userId,
        input.generationId,
        input.model,
        QuotaManager.estimateInputTokens(this.chatChars(input.chatId) + (userRowExists ? 0 : chatText.length)),
      );
    }

    const now = new Date(this.now());
    let conflict: ReplaceConflict | null;
    try {
      conflict = this.db.transaction((tx): ReplaceConflict | null => {
        const chat = tx.select().from(chats).where(eq(chats.id, input.chatId)).get();
        if (chat && chat.userId !== input.userId) throw new ForbiddenError("Not your chat");
        let victims: string[] = [];
        if (input.replaceFromMessageId) {
          // Edit and Regenerate replace in one request: no separate truncate round trip, and a failed
          // start leaves the server's turns exactly as they were. The caller's stop was awaited, so the
          // turns are checked again here, where nothing can interleave: deleting a running reply's rows
          // fails its finalize and loses its usage rows, and a target already gone would append (#21).
          const from = tx
            .select({ position: messages.position })
            .from(messages)
            .where(and(eq(messages.id, input.replaceFromMessageId), eq(messages.chatId, input.chatId)))
            .get();
          if (!from) return "replace_gone";
          victims = tx
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.chatId, input.chatId), gte(messages.position, from.position)))
            .all()
            .map((v) => v.id);
          const running = new Set([...this.active.values()].map((a) => a.messageId));
          if (victims.some((id) => running.has(id))) return "replace_running";
        }
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
        if (victims.length > 0) {
          tx.delete(generations).where(inArray(generations.messageId, victims)).run();
          tx.delete(messages).where(inArray(messages.id, victims)).run();
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
            thinking: input.thinking,
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
            provider: provider.name,
            scenario: input.scenario ?? null,
            startedAt: now,
          })
          .run();
        return null;
      });
    } catch (err) {
      this.quota.release(input.userId, input.generationId);
      throw err;
    }
    if (conflict) {
      // Returned before the transaction wrote anything.
      this.quota.release(input.userId, input.generationId);
      return { created: false, reason: conflict };
    }

    this.store.open(input.generationId);
    const active: Active = {
      id: input.generationId,
      chatId: input.chatId,
      userId: input.userId,
      messageId: input.assistantMessageId,
      requestedModel: input.model,
      scenario: input.scenario ?? null,
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
      billable,
    };
    this.active.set(active.id, active);
    this.append(active, {
      type: "started",
      chatId: input.chatId,
      messageId: input.assistantMessageId,
      userMessageId: input.userMessageId,
      requestedModel: input.model,
      scenario: input.scenario ?? null,
    });
    active.promise = this.run(active, input).catch((err) => {
      console.error(`[engine] generation ${active.id} crashed`, err);
    });
    return { created: true };
  }

  /** Stops and settles every running generation of a user (admin delete or ban, #69). */
  async stopUser(userId: string): Promise<void> {
    const ids = [...this.active.values()].filter((a) => a.userId === userId).map((a) => a.id);
    await Promise.all(ids.map((id) => this.stopAndWait(id)));
  }

  /** D5: aborts upstream and appends `stopped`. Returns false if not running here. */
  stop(generationId: string): boolean {
    const active = this.active.get(generationId);
    if (!active || active.abortReason) return false;
    active.abortReason = "stop";
    active.controller.abort(new DOMException("stop", "AbortError"));
    return true;
  }

  /** Stop and wait until the generation has written its rows and settled its cost. */
  async stopAndWait(generationId: string): Promise<void> {
    const active = this.active.get(generationId);
    if (!active) return;
    this.stop(generationId);
    await active.promise;
  }

  /** Callers that delete a chat's rows must settle its generations first. */
  async stopChat(chatId: string): Promise<void> {
    const ids = [...this.active.values()].filter((a) => a.chatId === chatId).map((a) => a.id);
    await Promise.all(ids.map((id) => this.stopAndWait(id)));
  }

  /** D2 resume branches. Ownership is checked before any buffer is served. */
  resume(generationId: string, userId: string | null): ResumeOutcome {
    const owner = this.owner(generationId);
    if (owner === null) return { kind: "not_found" };
    if (userId !== null && owner !== userId) throw new ForbiddenError();
    if (this.store.has(generationId)) return { kind: "live" };
    const row = this.db.select().from(generations).where(eq(generations.id, generationId)).get();
    if (!row) return { kind: "not_found" };
    if (row.status === "running") {
      // The process restarted while this was running: nothing can finish it. Settle its estimated
      // cost as the boot backstop does (cap review, finding 3); the provider column keeps a crashed
      // scenario run free (D22).
      const now = new Date(this.now());
      this.db.transaction((tx) => {
        settleOrphan(tx as unknown as Db, { id: row.id, messageId: row.messageId, chatId: row.chatId, userId: row.userId, requestedModel: row.requestedModel, provider: row.provider }, now);
      });
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
      lastSeq: message.lastSeq,
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
    try {
      if (input.gate) await input.gate.catch(() => {});
      if (active.controller.signal.aborted) {
        this.finishAborted(active, active.abortReason ?? "stop", timings);
        return;
      }
      const history = this.loadHistory(active.chatId, active.messageId);
      const provider = this.providers({
        userId: input.userId,
        userRole: input.userRole,
        model: input.model,
        scenario: input.scenario,
      });
      active.partialTimer = setInterval(() => this.persistPartial(active), this.partialPersistMs);
      active.partialTimer.unref?.();
      const request: ProviderRequest = {
        model: input.model,
        thinking: input.thinking,
        messages: history,
        userId: input.userId,
        scenario: input.scenario,
        cacheTail: input.cacheTail,
      };

      for (let attempt = 0; ; attempt++) {
        const error = await this.attempt(active, provider, request, timings);
        if (!error) break;
        // Before the API has begun a message nothing is lost, so a retryable failure is sent again.
        const retry = input.retry;
        if (retry && attempt < retry.attempts && error.retryable && !active.acc.apiMessageId) {
          await sleep(Math.max(retry.baseMs * 2 ** attempt, error.retryAfterMs ?? 0), active.controller.signal);
          continue;
        }
        if (error.kind === "network" && active.acc.apiMessageId) {
          this.finishInterrupted(active, "upstream", timings, error.message);
          return;
        }
        this.finishError(active, error, timings);
        return;
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
      this.finishError(active, toRelayError(err), timings);
    }
  }

  /** One upstream request relayed to its end: a failure comes back classified, an abort propagates. */
  private async attempt(active: Active, provider: Provider, request: ProviderRequest, timings: ServerTimings): Promise<RelayError | null> {
    try {
      const stream = provider.stream(request, { signal: active.controller.signal });
      const iterator = stream[Symbol.asyncIterator]();
      for (;;) {
        const step = await this.nextOrIdle(iterator);
        if (step === "idle") {
          active.abortReason = "idle";
          active.controller.abort(new DOMException("idle", "AbortError"));
          void iterator.return?.().catch(() => {});
          return null;
        }
        if (step.done) return null;
        const raw = step.value;
        if (active.controller.signal.aborted) return null;
        const bodies = normalizeEvent(raw, active.acc);
        for (const body of bodies) {
          if ((body.type === "text_delta" || body.type === "thinking_delta") && active.firstTokenAt === null) {
            active.firstTokenAt = this.now();
            timings.upstreamFirstToken = active.firstTokenAt;
          }
          if (body.type === "error") return body.error;
          this.append(active, body);
          // D22: metered as it streams; at the cap every running reply of the user stops.
          if ((body.type === "text_delta" || body.type === "thinking_delta") && active.billable && this.quota.meter(active.id, body.text.length)) {
            this.stopAtCap(active.userId);
          }
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
        if (active.controller.signal.aborted) return null;
      }
    } catch (err) {
      if (active.controller.signal.aborted || isAbortError(err)) throw err;
      return err instanceof ProviderStatusError ? statusErrorToRelay(err) : toRelayError(err);
    }
  }

  /** The user's spend plus their live replies reached the cap: each running reply ends, keeping its text. */
  private stopAtCap(userId: string): void {
    for (const active of this.active.values()) {
      if (active.userId !== userId || active.abortReason) continue;
      active.abortReason = "cap";
      active.controller.abort(new DOMException("cap", "AbortError"));
    }
  }

  private append(active: Active, body: RelayEventBody): void {
    this.store.append(active.id, body);
    active.relayed++;
  }

  /** D16: the next upstream event, or "idle" when none arrives within `upstreamIdleMs` (a half-open socket must not hold a generation open for ever). */
  private nextOrIdle(iterator: AsyncIterator<NormalizableEvent>): Promise<IteratorResult<NormalizableEvent> | "idle"> {
    const next = iterator.next();
    if (this.upstreamIdleMs <= 0) return next;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const idle = new Promise<"idle">((resolve) => {
      timer = setTimeout(() => resolve("idle"), this.upstreamIdleMs);
    });
    return Promise.race([next, idle]).then(
      (result) => {
        if (timer) clearTimeout(timer);
        if (result === "idle") next.catch(() => {});
        return result;
      },
      (err: unknown) => {
        if (timer) clearTimeout(timer);
        throw err;
      },
    );
  }

  /** The seq of the last event folded into the accumulator: both advance in the same synchronous step. */
  private coveredSeq(active: Active): number {
    return (this.store.get(active.id)?.events.length ?? 0) - 1;
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
        lastSeq: this.coveredSeq(active),
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
    const rows = this.free(active, this.priceFinal(active, servingModel));
    const usage = summarize(rows, false);
    const refused = acc.stopReason === "refusal";
    const status: MessageStatus = refused ? "refused" : "done";
    const content = toContentBlocks(acc);
    // Only real streams teach the estimator; a scripted pace would skew what stopped replies are billed.
    if (active.billable && active.firstTokenAt !== null && !refused) {
      this.tps.record(servingModel, usage.outputTokens, timings.done - active.firstTokenAt);
    }
    this.settle(
      active,
      { content, status, generationStatus: "done", servingModel, stopReason: acc.stopReason, timings, rows },
      { type: "done", stopReason: acc.stopReason, servingModel, usage, timings },
    );
    if (status === "done" && this.afterDone) {
      try {
        this.afterDone({
          chatId: active.chatId,
          messageId: active.messageId,
          generationId: active.id,
          userId: active.userId,
          scenario: active.scenario,
          billable: active.billable,
          text: content.filter((b) => b.type === "text").map((b) => b.text).join(""),
        });
      } catch (err) {
        console.error(`[engine] afterDone failed for ${active.id}`, err);
      }
    }
  }

  private finishAborted(active: Active, reason: AbortReason, timings: ServerTimings): void {
    if (reason === "cap") {
      this.finishError(active, { kind: "quota_exceeded", message: "Spending cap reached", retryable: false }, timings);
      return;
    }
    if (reason === "stop") {
      const servingModel = resolveServingModel(active.acc);
      timings.done = this.now();
      // A stop that lands after the final usage frame has exact numbers; only an earlier one estimates (finding 4).
      const exact = active.acc.stopReason !== null;
      const rows = exact ? this.free(active, this.priceFinal(active, servingModel ?? active.requestedModel)) : this.estimateRows(active, servingModel ?? active.requestedModel);
      const usage = rows.length ? summarize(rows, !exact) : null;
      this.settle(
        active,
        { content: toContentBlocks(active.acc), status: "stopped", generationStatus: "stopped", servingModel, stopReason: null, timings, rows, estimated: !exact },
        { type: "stopped", servingModel, usage },
      );
      return;
    }
    if (reason === "idle") {
      this.finishInterrupted(active, "upstream", timings, `No data from the model for ${Math.round(this.upstreamIdleMs / 1000)} s`);
      return;
    }
    this.finishInterrupted(active, reason === "shutdown" ? "shutdown" : "crash", timings);
  }

  private finishInterrupted(active: Active, reason: InterruptedReason, timings: ServerTimings, message?: string): void {
    const servingModel = resolveServingModel(active.acc);
    timings.done = this.now();
    const rows = this.estimateRows(active, servingModel ?? active.requestedModel);
    this.settle(
      active,
      { content: toContentBlocks(active.acc), status: "interrupted", generationStatus: "interrupted", interruptedReason: reason, servingModel, stopReason: null, timings, rows },
      { type: "interrupted", reason, message },
    );
  }

  private finishError(active: Active, error: RelayError, timings: ServerTimings): void {
    const servingModel = resolveServingModel(active.acc);
    timings.done = this.now();
    const rows = active.acc.apiMessageId ? this.estimateRows(active, servingModel ?? active.requestedModel) : [];
    this.settle(
      active,
      { content: toContentBlocks(active.acc), status: "error", generationStatus: "error", servingModel, stopReason: null, timings, rows, error },
      { type: "error", error },
    );
  }

  /**
   * The terminal event, the cost settlement and the cleanup happen whatever the
   * database says: a chat deleted mid-stream must not leave a buffer without an
   * end, a quota reservation held, or spend unrecorded.
   */
  private settle(active: Active, final: FinalState, terminal: RelayEventBody): void {
    const cost = final.rows.reduce((s, r) => s + r.costUsd, 0);
    // The spend increment rides in the final transaction with the usage rows (finding 6); only when
    // that transaction fails is it attempted on its own, so spend and rows never disagree.
    let finalized = false;
    try {
      this.finalize(active, final, cost);
      finalized = true;
    } catch (err) {
      console.error(`[engine] finalize failed for ${active.id} (rows gone?)`, err);
    }
    try {
      if (finalized) this.quota.release(active.userId, active.id);
      else this.quota.settle(active.userId, active.id, cost);
    } catch (err) {
      console.error(`[engine] settle failed for ${active.id}`, err);
      this.quota.release(active.userId, active.id);
    }
    try {
      this.append(active, terminal);
    } catch (err) {
      console.error(`[engine] terminal event failed for ${active.id}`, err);
    }
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

  /** Usage rows for a run that spends nothing keep their tokens and model but cost zero. */
  private free(active: Active, rows: UsageRow[]): UsageRow[] {
    return active.billable ? rows : rows.map((r) => ({ ...r, costUsd: 0 }));
  }

  // D22: input tokens are exact from message_start; output is elapsed time times measured tokens/s,
  // because billed output includes full thinking while only its summary is visible.
  private estimateRows(active: Active, servingModel: string): UsageRow[] {
    const u = active.acc.usage;
    if (!active.acc.apiMessageId) return [];
    const from = active.firstTokenAt ?? active.startedAt;
    const outputTokens = this.tps.estimateOutputTokens(servingModel, this.now() - from);
    return this.free(active, priceIterations(
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
    ));
  }

  private finalize(active: Active, final: FinalState, costUsd: number): void {
    const now = new Date(this.now());
    const estimated = final.estimated ?? final.generationStatus !== "done";
    this.db.transaction((tx) => {
      if (active.billable) QuotaManager.addSpend(tx as unknown as Db, active.userId, costUsd);
      tx.update(messages)
        .set({
          content: final.content,
          status: final.status,
          servingModel: final.servingModel,
          stopReason: final.stopReason,
          refusal: active.acc.refusal,
          error: final.error ?? null,
          timings: { server: final.timings },
          // The terminal event is appended right after this write and takes the next seq.
          lastSeq: this.coveredSeq(active) + 1,
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
    case 413:
      return { kind: "context_full", message: "This chat is too long to continue", retryable: false, status: 413 };
    case 400:
      if (CONTEXT_FULL_RE.test(err.message)) {
        return { kind: "context_full", message: "This chat is too long to continue", retryable: false, status: 400 };
      }
      return { kind: "bad_request", message: err.message, retryable: false, status: 400 };
    default:
      return { kind: "api_error", message: err.message, retryable: err.status >= 500, status: err.status };
  }
}

