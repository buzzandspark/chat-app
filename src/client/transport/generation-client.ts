import { isTerminal, type RelayEvent } from "@relay/events";
import { createSseParser, parseRelayEvent } from "@relay/sse";
import { uuidv7 } from "@shared/id";
import { MAX_MESSAGE_CHARS, type ModelId, type ThinkingOptions } from "@shared/types";
import { createMessageState, type ChatStore } from "../store/chat-store";

export interface SendInput {
  chatId: string;
  text: string;
  model: ModelId;
  thinking: ThinkingOptions;
  scenario?: string;
  /** D10: an edit replaces this message and everything after it, in the same request. */
  replaceFrom?: string;
}

export interface SendHooks {
  /** The server accepted the generation (the POST answered 2xx, or a resume found it): safe to list the chat. */
  onAccepted?: () => void;
}

export interface RetryInput {
  chatId: string;
  userMessageId: string;
  /** The user message's text, so a retry after a refused first POST (the server never saw it) can create it. */
  text?: string;
  model: ModelId;
  thinking: ThinkingOptions;
  scenario?: string;
  /** Regenerate replaces the old reply (and anything after it) in the same request. */
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
/**
 * D2: re-POSTs after a resume found the server never saw the generation. A POST that keeps failing
 * at the network level while the GET gets through (a proxy resetting on the body, an extension
 * blocking /api/chat) is not a flaky connection: after this many the reply ends as a network error.
 */
const MAX_REPOSTS = 3;
/** D16 watchdog: the server writes a keepalive every 15 s, so longer silence is a half-open socket. */
const DEFAULT_IDLE_MS = 25_000;

interface Inflight {
  controller: AbortController;
  /** Preempts whatever the loop is waiting on (a stale read, a backoff sleep) so it retries now. */
  nudge: (() => void) | null;
}

/** D2/D16: failures after the POST go through the resume path with backoff; ids are chosen here. */
export class GenerationClient {
  private inflight = new Map<string, Inflight>();
  private bodies = new Map<string, PostBody>();
  /** Generations the server has acknowledged: a later 404 means the chat is gone, not that the POST was lost. */
  private acked = new Set<string>();
  private accepted = new Map<string, () => void>();
  private backoff: BackoffOptions;
  private idleMs: number;
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
    } = {},
  ) {
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.sleepImpl = options.sleep ?? sleep;
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.resumeAll());
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") this.resumeAll();
      });
    }
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
    return { generationId, assistantMessageId };
  }

  async stop(generationId: string): Promise<boolean> {
    const res = await this.fetchImpl(`/api/generations/${generationId}/stop`, { method: "POST" });
    if (!res.ok) return false;
    const data = (await res.json()) as { stopped: boolean };
    return data.stopped;
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

  /**
   * D16: `online` and `visibilitychange` trigger an immediate attempt for every pending message. A
   * loop already in flight is nudged: a read that went quiet is cancelled and a backoff sleep is cut
   * short, so recovery does not wait for the 25 s watchdog or the next scheduled attempt.
   */
  resumeAll(): void {
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
      let res: Response;
      try {
        res = await this.fetchImpl("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        return controller.signal.aborted ? "done" : "unsent";
      }
      if (!res.ok) {
        this.failFromResponse(body.assistantMessageId, res, await safeJson(res));
        return "done";
      }
      this.accept(body.generationId);
      const finished = await this.consume(res, entry, body.generationId, body.assistantMessageId);
      return finished || controller.signal.aborted ? "done" : "cut";
    } finally {
      if (this.inflight.get(body.generationId) === entry) this.inflight.delete(body.generationId);
    }
  }

  /**
   * Resume from the last seq; when the server never saw the POST, send it again with the same ids
   * (D2) and resume after that. A loop, not post and resume calling each other, so a POST that
   * keeps failing does not grow a promise chain, and the backoff attempt carries across re-POSTs:
   * otherwise each resume starts at attempt 0, which skips the sleep, and the POST/GET pair spins.
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
          error: { kind: "network", message: "Could not send this message", retryable: true },
        });
        return;
      }
      const sent = await this.postOnce(body);
      if (sent === "done") return;
      // Accepted then cut is progress: catch up as a fresh start, as the first POST's cut does.
      attempt = sent === "unsent" ? lostAt + 1 : 0;
    }
  }

  /**
   * The resume GET loop, starting at `start` on the backoff schedule. Resolves to the attempt at
   * which a 404 said the server never saw the POST and there is a body to send again; null when
   * the loop ended any other way.
   */
  private async resumeOnce(generationId: string, messageId: string, start: number): Promise<number | null> {
    if (this.inflight.has(generationId)) return null;
    const controller = new AbortController();
    const entry: Inflight = { controller, nudge: null };
    this.inflight.set(generationId, entry);
    try {
      let waitMs = 0;
      for (let attempt = start; attempt < this.backoff.maxAttempts; attempt++) {
        if (this.isSettled(messageId)) return null;
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          this.store.setConnection(messageId, "offline", attempt);
          return null;
        }
        this.store.setConnection(messageId, "reconnecting", attempt);
        if (attempt > 0 || waitMs > 0) {
          const backoff = attempt > 0 ? Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** (attempt - 1)) * (0.7 + Math.random() * 0.6) : 0;
          // A nudge (online, visible) cuts the sleep short; aborting the loop ends it.
          const wake = new AbortController();
          entry.nudge = () => wake.abort();
          await this.sleepImpl(Math.max(backoff, waitMs), anySignal(controller.signal, wake.signal));
          entry.nudge = null;
          waitMs = 0;
          if (controller.signal.aborted) return null;
        }
        this.store.flush(); // the cursor must include everything already received
        const after = this.store.getMessage(messageId)?.lastSeq ?? -1;
        let res: Response;
        try {
          res = await this.fetchImpl(`/api/generations/${generationId}/events?after=${after}`, { signal: controller.signal });
        } catch {
          if (controller.signal.aborted) return null;
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
          // The server never received the POST: the caller re-POSTs with the same ids (D2).
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
          // A server that is restarting, overloaded or rate limiting still has the reply: keep trying.
          // Only a definite answer about this client or this generation ends the loop.
          if (res.status >= 500 || res.status === 429 || res.status === 408) {
            const retryAfter = Number(res.headers.get("retry-after"));
            waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 0;
            continue;
          }
          this.failFromResponse(messageId, res, await safeJson(res));
          return null;
        }
        this.accept(generationId);
        const finished = await this.consume(res, entry, generationId, messageId);
        if (finished || controller.signal.aborted) return null;
        // Nothing left to fetch for a reply that has already ended here.
        if (this.isSettled(messageId)) return null;
        // Stream ended without a terminal event: try again, counting progress as a fresh start.
        if ((this.store.getMessage(messageId)?.lastSeq ?? -1) > after) attempt = -1;
      }
      this.store.setConnection(messageId, "offline", this.backoff.maxAttempts);
      return null;
    } finally {
      if (this.inflight.get(generationId) === entry) this.inflight.delete(generationId);
    }
  }

  /** Resolves true when a terminal event arrived. */
  private async consume(res: Response, entry: Inflight, generationId: string, messageId: string): Promise<boolean> {
    const { signal } = entry.controller;
    this.store.setConnection(messageId, "streaming", 0);
    if (!res.body) return false;
    const reader = res.body.getReader();
    // A nudge (online, visible) treats the current read as stale: cancel it and resume from the last seq.
    entry.nudge = () => void reader.cancel().catch(() => {});
    const decoder = new TextDecoder();
    let terminal = false;
    let firstByte = false;
    // D16 watchdog: cancelling the reader ends the read loop without a terminal event, and the
    // caller resumes from the last seq with the usual backoff.
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
      // connection dropped mid-stream
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

  /** D20: client stamps join the server's by message id; first paint lands a frame after `done`. */
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
      // The snapshot's message id is authoritative but the local placeholder may differ after a reload.
      if (event.message.id !== messageId && !this.store.getMessage(event.message.id)) {
        event = { ...event, message: { ...event.message, id: messageId } };
      }
    }
    this.store.enqueue(event);
  }

  private failFromResponse(messageId: string, res: Response, body: Record<string, unknown>): void {
    const retryAfterHeader = Number(res.headers.get("retry-after"));
    const retryAfterMs = typeof body.retryAfterMs === "number" ? body.retryAfterMs : Number.isFinite(retryAfterHeader) ? retryAfterHeader * 1000 : undefined;
    const kind =
      body.error === "quota_exceeded"
        ? "quota_exceeded"
        : body.error === "rate_limited"
          ? "rate_limited"
          : res.status === 401
            ? "session"
            : res.status === 403
              ? "forbidden"
              : res.status === 503
                ? "unavailable"
                : "bad_request";
    const message =
      kind === "quota_exceeded"
        ? "You have used your whole budget on this instance"
        : kind === "rate_limited"
          ? "Too many messages, slow down a little"
          : kind === "session"
            ? "Your session has ended"
            : kind === "forbidden"
              ? "This chat belongs to another account"
              : kind === "unavailable"
                ? "The server is restarting"
                : tooLong(body)
                  ? `This message is too long (the limit is ${MAX_MESSAGE_CHARS.toLocaleString()} characters)`
                  : `Request failed (${res.status})`;
    this.store.updateMessage(messageId, {
      status: "error",
      connection: "idle",
      error: { kind, message, retryable: kind === "rate_limited" || kind === "unavailable", retryAfterMs: retryAfterMs ?? (kind === "unavailable" ? 5000 : undefined), status: res.status },
    });
  }
}

/** The route's 400 for a message over the limit (zod's `too_big` on `text`). */
function tooLong(body: Record<string, unknown>): boolean {
  const issues = body.issues;
  return Array.isArray(issues) && issues.some((i) => (i as { code?: string; path?: unknown[] }).code === "too_big" && (i as { path?: unknown[] }).path?.[0] === "text");
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

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
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
/** One transport per store; on the server that is per request and never used. */
export function getGenerationClient(store: ChatStore): GenerationClient {
  let client = clients.get(store);
  if (!client) {
    client = new GenerationClient(store);
    clients.set(store, client);
  }
  return client;
}
