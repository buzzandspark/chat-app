import { isTerminal, type RelayEvent } from "@relay/events";
import { createSseParser, parseRelayEvent } from "@relay/sse";
import { readJson, type ApiError, type StopResponse } from "@shared/api";
import { uuidv7 } from "@shared/id";
import type { ModelId, ThinkingOptions } from "@shared/types";
import { createMessageState, type ChatStore, type MessageState } from "../store/chat-store";
import { followReply } from "../store/announcer";
import { getSidebarStore } from "../store/sidebar-store";

export interface SendInput {
  chatId: string;
  text: string;
  model: ModelId;
  thinking: ThinkingOptions;
  scenario?: string;
  /** An edit replaces this message and everything after it, in the same request. */
  replaceFrom?: string;
}

export interface SendHooks {
  /** The server accepted the generation (POST 2xx, or a resume found it): safe to list the chat. */
  onAccepted?: () => void;
}

export interface RetryInput {
  chatId: string;
  userMessageId: string;
  /** Lets a retry after a refused first POST (the server never saw it) create the user message. */
  text?: string;
  model: ModelId;
  thinking: ThinkingOptions;
  scenario?: string;
  /** See retryReplaceFrom. */
  replaceFrom?: string;
  /** Automatic retries after a 429 count up here; the footer's backoff reads it. */
  attempt?: number;
}

interface PostBody {
  chatId: string;
  generationId: string;
  messageId: string;
  assistantMessageId: string;
  text?: string;
  model: ModelId;
  thinking: ThinkingOptions;
  scenario?: string;
  replaceFromMessageId?: string;
}

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;
}

const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 8000, maxAttempts: 10 };
/** A POST that keeps failing while the resume GET gets through (proxy, extension blocking /api/chat) is not flakiness. */
const MAX_REPOSTS = 3;
/** A replace refused because a turn it drops is still running is sent again this many times. */
const MAX_BUSY_REPOSTS = 5;
/** The server writes a keepalive every 15 s, so longer silence is a half-open socket. */
const DEFAULT_IDLE_MS = 25_000;
/**
 * Without it a request into a half-open socket waits for the OS TCP timeout. Headers come before any model
 * work, so 15 s is generous; a false timeout costs only an idempotent retry.
 */
const DEFAULT_HEADERS_MS = 15_000;

interface Inflight {
  controller: AbortController;
  /** Preempts whatever the loop is waiting on (headers, a stale read, a backoff sleep) so it retries now. */
  nudge: (() => void) | null;
}

/** Failures after the POST go through the resume path with backoff; ids are chosen client-side so retries are idempotent. */
export class GenerationClient {
  private inflight = new Map<string, Inflight>();
  private bodies = new Map<string, PostBody>();
  /** Generations the server has acknowledged: a later 404 means the chat is gone, not that the POST was lost. */
  private acked = new Set<string>();
  private accepted = new Map<string, () => void>();
  private backoff: BackoffOptions;
  private idleMs: number;
  private headersMs: number;
  private fetchImpl: typeof fetch;
  private sleepImpl: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private store: ChatStore,
    options: {
      fetch?: typeof fetch;
      backoff?: Partial<BackoffOptions>;
      sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
      /** No bytes for this long drops the connection and resumes from the last seq (0 disables). */
      idleMs?: number;
      /** A request with no response headers for this long is dropped and retried (0 disables). */
      headersMs?: number;
    } = {},
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.headersMs = options.headersMs ?? DEFAULT_HEADERS_MS;
    this.sleepImpl = options.sleep ?? sleep;
    store.onReplyEnd((message) => this.sendQueued(message));
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.resumeAll());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.resumeAll();
      });
    }
  }

  /** One generation at a time per chat; a failed reply keeps the queue and leaves the decision to the user. */
  private sendQueued(reply: MessageState): void {
    if (reply.role !== "assistant" || reply.status === "error") return;
    // After the store's commit, not inside it; and only while that reply is still the chat's last.
    queueMicrotask(() => {
      const chat = this.store.getChat(reply.chatId);
      if (chat.messageIds.at(-1) !== reply.id) return;
      const next = this.store.takeQueued(reply.chatId);
      if (!next) return;
      const title = chat.title ?? next.text.slice(0, 60);
      this.send(
        { chatId: reply.chatId, text: next.text, model: chat.settings.model, thinking: chat.settings.thinking, scenario: next.scenario ?? undefined },
        { onAccepted: () => getSidebarStore().upsert({ id: reply.chatId, title, updatedAt: Date.now() }) },
      );
    });
  }

  /** Optimistic send: both messages appear immediately; the stream fills the second. */
  send(input: SendInput, hooks: SendHooks = {}): { generationId: string; userMessageId: string; assistantMessageId: string } {
    const generationId = uuidv7();
    const userMessageId = uuidv7();
    const assistantMessageId = uuidv7();
    const now = Date.now();
    this.store.addMessage(
      createMessageState({
        id: userMessageId,
        chatId: input.chatId,
        role: "user",
        blocks: [{ type: "text", text: input.text }],
        createdAt: now,
      }),
    );
    this.store.addMessage(
      createMessageState({
        id: assistantMessageId,
        chatId: input.chatId,
        role: "assistant",
        status: "streaming",
        requestedModel: input.model,
        generationId,
        connection: "streaming",
        timings: { client: { sent: now } },
        createdAt: now + 1,
      }),
    );
    const body: PostBody = {
      chatId: input.chatId,
      generationId,
      messageId: userMessageId,
      assistantMessageId,
      text: input.text,
      model: input.model,
      thinking: input.thinking,
      scenario: input.scenario,
      replaceFromMessageId: input.replaceFrom,
    };
    this.bodies.set(generationId, body);
    if (hooks.onAccepted) this.accepted.set(generationId, hooks.onAccepted);
    void this.post(body);
    followReply(this.store, input.chatId, assistantMessageId);
    return { generationId, userMessageId, assistantMessageId };
  }

  /** Regenerate after an interrupted or stopped reply: same user message, new assistant message. */
  retry(input: RetryInput, hooks: SendHooks = {}): { generationId: string; assistantMessageId: string } {
    const generationId = uuidv7();
    const assistantMessageId = uuidv7();
    const now = Date.now();
    this.store.addMessage(
      createMessageState({
        id: assistantMessageId,
        chatId: input.chatId,
        role: "assistant",
        status: "streaming",
        requestedModel: input.model,
        generationId,
        connection: "streaming",
        timings: { client: { sent: now } },
        createdAt: now,
        retryAttempt: input.attempt ?? 0,
      }),
    );
    const body: PostBody = {
      chatId: input.chatId,
      generationId,
      messageId: input.userMessageId,
      assistantMessageId,
      text: input.text,
      model: input.model,
      thinking: input.thinking,
      scenario: input.scenario,
      replaceFromMessageId: input.replaceFrom,
    };
    this.bodies.set(generationId, body);
    if (hooks.onAccepted) this.accepted.set(generationId, hooks.onAccepted);
    void this.post(body);
    followReply(this.store, input.chatId, assistantMessageId);
    return { generationId, assistantMessageId };
  }

  /**
   * An accepted reply is a server row, so the retry replaces from it. An unaccepted one changed nothing there,
   * so the retry carries that attempt's original target (none for a plain send); the server refuses unknown targets.
   */
  retryReplaceFrom(reply: Pick<MessageState, "id" | "generationId">): string | undefined {
    const gid = reply.generationId;
    const unaccepted = gid && !this.acked.has(gid) ? this.bodies.get(gid) : undefined;
    return unaccepted ? unaccepted.replaceFromMessageId : reply.id;
  }

  /**
   * Never rejects: the composer holds Stop disabled until this settles, so every failure must come back as
   * false or Stop stays dead. False is safe to retry; a second stop changes nothing.
   */
  async stop(generationId: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = this.headersMs > 0 ? setTimeout(() => controller.abort(), this.headersMs) : null;
    try {
      const res = await this.fetchImpl(`/api/generations/${generationId}/stop`, { method: "POST", signal: controller.signal });
      if (!res.ok) return false;
      return (await safeJson<StopResponse>(res)).stopped === true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Resume a generation this client did not start (e.g. after a reload mid-stream). */
  attach(generationId: string, messageId: string): void {
    if (this.inflight.has(generationId)) return;
    // The row the caller saw may be stale: a reply that already finished here has nothing to resume.
    const current = this.store.getMessage(messageId);
    if (current && current.status !== "streaming") return;
    this.store.updateMessage(messageId, { generationId, connection: "reconnecting" });
    void this.resume(generationId, messageId);
  }

  /** A loop already in flight is nudged, so recovery does not wait for a watchdog or the next backoff. */
  resumeAll(): void {
    // A hidden tab runs no rAF, so a finished reply's terminal event may still be queued: apply it first.
    this.store.flush();
    for (const m of this.store.pendingMessages()) {
      if (!m.generationId) continue;
      const entry = this.inflight.get(m.generationId);
      if (entry) entry.nudge?.();
      else void this.resume(m.generationId, m.id);
    }
  }

  private accept(generationId: string): void {
    this.acked.add(generationId);
    const cb = this.accepted.get(generationId);
    if (cb) {
      this.accepted.delete(generationId);
      cb();
    }
  }

  private isSettled(messageId: string): boolean {
    const m = this.store.getMessage(messageId);
    return m !== undefined && m.status !== "streaming";
  }

  private async post(body: PostBody): Promise<void> {
    if ((await this.postOnce(body)) !== "done") await this.resume(body.generationId, body.assistantMessageId);
  }

  /**
   * One POST. "unsent": it failed at the network level, so the server may or may not have it and
   * resume decides; "cut": accepted, but the stream ended before a terminal event; "done": anything else.
   */
  private async postOnce(body: PostBody): Promise<"done" | "unsent" | "cut"> {
    const controller = new AbortController();
    const entry: Inflight = { controller, nudge: null };
    this.inflight.set(body.generationId, entry);
    try {
      for (let busy = 0; ; busy++) {
        const res = await this.fetchAttempt(entry, "/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (typeof res === "string") return controller.signal.aborted ? "done" : "unsent";
        if (res.ok) {
          this.accept(body.generationId);
          const finished = await this.consume(res, entry, body.generationId, body.assistantMessageId);
          return finished || controller.signal.aborted ? "done" : "cut";
        }
        const json = await safeJson<ApiError>(res);
        // A turn this replace drops was still running; the server changed nothing, and the next POST stops it first.
        if (json.error === "replace_running" && busy < MAX_BUSY_REPOSTS) {
          const retryAfter = Number(res.headers.get("retry-after"));
          await this.sleepImpl(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000, controller.signal);
          if (controller.signal.aborted) return "done";
          continue;
        }
        this.failFromResponse(body.assistantMessageId, res, json);
        return "done";
      }
    } finally {
      if (this.inflight.get(body.generationId) === entry) this.inflight.delete(body.generationId);
    }
  }

  /**
   * A loop rather than mutual recursion, so a failing POST grows no promise chain and the backoff attempt
   * carries across re-POSTs (restarting at 0 skips the sleep and the POST/GET pair spins).
   */
  private async resume(generationId: string, messageId: string): Promise<void> {
    let attempt = 0;
    for (let reposts = 0; ; reposts++) {
      const lostAt = await this.resumeOnce(generationId, messageId, attempt);
      const body = this.bodies.get(generationId);
      if (lostAt === null || !body) return;
      if (reposts >= MAX_REPOSTS) {
        this.store.updateMessage(messageId, {
          status: "error",
          connection: "idle",
          error: { kind: "offline", message: "Couldn't send this message", retryable: true },
        });
        return;
      }
      const sent = await this.postOnce(body);
      if (sent === "done") return;
      // Accepted then cut is progress: catch up as a fresh start, as the first POST's cut does.
      attempt = sent === "unsent" ? lostAt + 1 : 0;
    }
  }

  /** Resolves to the attempt at which a 404 said the server never saw the POST (and a body exists); else null. */
  private async resumeOnce(generationId: string, messageId: string, start: number): Promise<number | null> {
    if (this.inflight.has(generationId)) return null;
    const controller = new AbortController();
    const entry: Inflight = { controller, nudge: null };
    this.inflight.set(generationId, entry);
    try {
      let waitMs = 0;
      let retryNow = false;
      for (let attempt = start; attempt < this.backoff.maxAttempts; attempt++) {
        if (this.isSettled(messageId)) return null;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          this.store.setConnection(messageId, "offline", attempt);
          return null;
        }
        this.store.setConnection(messageId, "reconnecting", attempt);
        if (retryNow) retryNow = false;
        else if (attempt > 0 || waitMs > 0) {
          const backoff = attempt > 0 ? Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** (attempt - 1)) * (0.7 + Math.random() * 0.6) : 0;
          const wake = new AbortController();
          entry.nudge = () => wake.abort();
          await this.sleepImpl(Math.max(backoff, waitMs), anySignal(controller.signal, wake.signal));
          entry.nudge = null;
          waitMs = 0;
          if (controller.signal.aborted) return null;
        }
        this.store.flush(); // the cursor must include everything already received
        const after = this.store.getMessage(messageId)?.lastSeq ?? -1;
        const res = await this.fetchAttempt(entry, `/api/generations/${generationId}/events?after=${after}`, {});
        if (typeof res === "string") {
          if (controller.signal.aborted) return null;
          retryNow = res === "nudged";
          continue;
        }
        if (res.status === 404) {
          if (this.acked.has(generationId)) {
            // The server knew this generation and no longer does: its chat was deleted.
            this.store.updateMessage(messageId, {
              status: "error",
              connection: "idle",
              error: { kind: "gone", message: "This chat was deleted", retryable: false, status: 404 },
            });
            return null;
          }
          // The server never received the POST: the caller re-POSTs with the same ids.
          if (!this.bodies.has(generationId)) {
            this.store.updateMessage(messageId, {
              status: "error",
              connection: "idle",
              error: { kind: "unknown", message: "This reply was lost", retryable: false },
            });
            return null;
          }
          return attempt;
        }
        if (!res.ok) {
          // A restarting, overloaded or rate-limiting server still has the reply: keep trying.
          if (res.status >= 500 || res.status === 429 || res.status === 408) {
            const retryAfter = Number(res.headers.get("retry-after"));
            waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
            continue;
          }
          this.failFromResponse(messageId, res, await safeJson<ApiError>(res));
          return null;
        }
        this.accept(generationId);
        const finished = await this.consume(res, entry, generationId, messageId);
        if (finished || controller.signal.aborted) return null;
        if (this.isSettled(messageId)) return null;
        // Progress counts as a fresh start on the backoff schedule.
        if ((this.store.getMessage(messageId)?.lastSeq ?? -1) > after) attempt = -1;
      }
      this.store.setConnection(messageId, "offline", this.backoff.maxAttempts);
      return null;
    } finally {
      if (this.inflight.get(generationId) === entry) this.inflight.delete(generationId);
    }
  }

  /**
   * Own controller so the headers timeout or a nudge drops only this attempt, not the loop.
   * "dropped" also covers the loop's own abort; callers check the loop's signal.
   */
  private async fetchAttempt(entry: Inflight, url: string, init: RequestInit): Promise<Response | "dropped" | "nudged"> {
    const attempt = new AbortController();
    let nudged = false;
    entry.nudge = () => {
      nudged = true;
      attempt.abort();
    };
    const timer = this.headersMs > 0 ? setTimeout(() => attempt.abort(), this.headersMs) : null;
    try {
      return await this.fetchImpl(url, { ...init, signal: anySignal(entry.controller.signal, attempt.signal) });
    } catch {
      return nudged ? "nudged" : "dropped";
    } finally {
      if (timer) clearTimeout(timer);
      entry.nudge = null;
    }
  }

  private async consume(res: Response, entry: Inflight, generationId: string, messageId: string): Promise<boolean> {
    const { signal } = entry.controller;
    this.store.setConnection(messageId, "streaming", 0);
    if (!res.body) return false;
    const reader = res.body.getReader();
    entry.nudge = () => void reader.cancel().catch(() => {});
    const decoder = new TextDecoder();
    let terminal = false;
    let firstByte = false;
    // Idle watchdog: cancelling the reader ends the loop without a terminal event, so the caller resumes.
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const armIdle = () => {
      if (this.idleMs <= 0) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => void reader.cancel().catch(() => {}), this.idleMs);
    };
    armIdle();
    const parser = createSseParser((msg) => {
      const event = parseRelayEvent(msg.data, generationId);
      if (!event) return;
      this.dispatch(event, messageId);
      if (isTerminal(event) || event.type === "snapshot") terminal = true;
    });
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        armIdle();
        if (!firstByte) {
          firstByte = true;
          this.store.markClientTiming(messageId, "firstByte");
        }
        parser.push(decoder.decode(value, { stream: true }));
        if (terminal) break;
      }
      parser.push(decoder.decode());
      parser.flush();
    } catch {
      if (signal.aborted) return terminal;
    } finally {
      entry.nudge = null;
      if (idleTimer) clearTimeout(idleTimer);
      try {
        reader.releaseLock();
      } catch {
        // already released
      }
    }
    if (terminal) {
      this.bodies.delete(generationId);
      this.store.markClientTiming(messageId, "done");
      this.persistClientTimings(messageId);
    }
    return terminal;
  }

  /** Delayed because first paint lands a frame after `done`. */
  private persistClientTimings(messageId: string): void {
    setTimeout(() => {
      const client = this.store.getMessage(messageId)?.timings?.client;
      if (!client) return;
      void this.fetchImpl(`/api/messages/${messageId}/timings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(client),
      }).catch(() => {});
    }, 250);
  }

  private dispatch(event: RelayEvent, messageId: string): void {
    if (event.type === "snapshot") {
      // The local placeholder id may differ from the snapshot's after a reload.
      if (event.message.id !== messageId && !this.store.getMessage(event.message.id)) {
        event = { ...event, message: { ...event.message, id: messageId } };
      }
    }
    this.store.enqueue(event);
  }

  private failFromResponse(messageId: string, res: Response, body: Partial<ApiError>): void {
    const retryAfterHeader = Number(res.headers.get("retry-after"));
    const retryAfterMs = typeof body.retryAfterMs === "number" ? body.retryAfterMs : Number.isFinite(retryAfterHeader) ? retryAfterHeader * 1000 : undefined;
    const kind =
      body.error === "quota_exceeded"
        ? "quota_exceeded"
        : body.error === "rate_limited"
          ? "rate_limited"
          : body.error === "replace_gone" || body.error === "replace_running"
            ? "conflict"
            : res.status === 401
              ? "session"
              : body.error === "guests_blocked"
                ? "guests_blocked"
                : res.status === 403
                  ? "forbidden"
                  : res.status === 503
                    ? "unavailable"
                    : "bad_request";
    const message =
      kind === "quota_exceeded"
        ? "You've reached your spending cap"
        : kind === "rate_limited"
          ? "Rate limited"
          : body.error === "replace_gone"
            ? "This chat has changed since you opened it"
            : body.error === "replace_running"
              ? "An earlier reply is still finishing"
              : kind === "session"
                ? "Your session has ended"
                : kind === "guests_blocked"
                  ? "Guests can't send messages right now"
                  : kind === "forbidden"
                    ? "This chat belongs to another account"
                    : kind === "unavailable"
                      ? "The server is restarting"
                      : "Couldn't send this message";
    this.store.updateMessage(messageId, {
      status: "error",
      connection: "idle",
      error: { kind, message, retryable: kind === "rate_limited" || kind === "unavailable" || body.error === "replace_running", retryAfterMs: retryAfterMs ?? (kind === "unavailable" ? 5000 : undefined), status: res.status },
    });
  }
}

function anySignal(...signals: AbortSignal[]): AbortSignal {
  const abortSignalAny = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (abortSignalAny) return abortSignalAny.call(AbortSignal, signals);
  const controller = new AbortController();
  for (const s of signals) {
    if (s.aborted) controller.abort();
    else s.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

async function safeJson<T>(res: Response): Promise<Partial<T>> {
  try {
    return await readJson<T>(res);
  } catch {
    return {};
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(), ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

const clients = new WeakMap<ChatStore, GenerationClient>();
/** On the server a store is per request and its client never used. */
export function getGenerationClient(store: ChatStore): GenerationClient {
  let client = clients.get(store);
  if (!client) {
    client = new GenerationClient(store);
    clients.set(store, client);
  }
  return client;
}
