import { isTerminal, type RelayEvent } from "@relay/events";
import { createSseParser, parseRelayEvent } from "@relay/sse";
import { uuidv7 } from "@shared/id";
import type { ModelId, ThinkingOptions } from "@shared/types";
import { createMessageState, type ChatStore } from "../store/chat-store";

export interface SendInput {
  chatId: string;
  text: string;
  model: ModelId;
  thinking: ThinkingOptions;
  scenario?: string;
}

export interface RetryInput {
  chatId: string;
  userMessageId: string;
  /** The user message's text, so a retry after a refused first POST (the server never saw it) can create it. */
  text?: string;
  model: ModelId;
  thinking: ThinkingOptions;
  scenario?: string;
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
}

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  maxAttempts: number;
}

const DEFAULT_BACKOFF: BackoffOptions = { baseMs: 500, maxMs: 8000, maxAttempts: 10 };
/** D16 watchdog: the server writes a keepalive every 15 s, so longer silence is a half-open socket. */
const DEFAULT_IDLE_MS = 25_000;

/** D2/D16: failures after the POST go through the resume path with backoff; ids are chosen here. */
export class GenerationClient {
  private inflight = new Map<string, AbortController>();
  private bodies = new Map<string, PostBody>();
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
  send(input: SendInput): { generationId: string; userMessageId: string; assistantMessageId: string } {
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
    };
    this.bodies.set(generationId, body);
    void this.post(body);
    return { generationId, userMessageId, assistantMessageId };
  }

  /** Regenerate after an interrupted or stopped reply: same user message, new assistant message. */
  retry(input: RetryInput): { generationId: string; assistantMessageId: string } {
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
    };
    this.bodies.set(generationId, body);
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
    this.store.updateMessage(messageId, { generationId, connection: "reconnecting" });
    void this.resume(generationId, messageId);
  }

  /** D16: `online` and `visibilitychange` trigger an immediate attempt for every pending message. */
  resumeAll(): void {
    for (const m of this.store.pendingMessages()) {
      if (m.generationId && !this.inflight.has(m.generationId)) void this.resume(m.generationId, m.id);
    }
  }

  private async post(body: PostBody): Promise<void> {
    const controller = new AbortController();
    this.inflight.set(body.generationId, controller);
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
        if (controller.signal.aborted) return;
        // Network failure: the server may or may not have received the POST. Resume decides.
        this.inflight.delete(body.generationId);
        await this.resume(body.generationId, body.assistantMessageId);
        return;
      }
      if (!res.ok) {
        this.failFromResponse(body.assistantMessageId, res, await safeJson(res));
        return;
      }
      const finished = await this.consume(res, body.generationId, body.assistantMessageId, controller.signal);
      if (!finished && !controller.signal.aborted) {
        // The stream was cut before a terminal event: catch up from the last seq.
        this.inflight.delete(body.generationId);
        await this.resume(body.generationId, body.assistantMessageId);
      }
    } finally {
      if (this.inflight.get(body.generationId) === controller) this.inflight.delete(body.generationId);
    }
  }

  private async resume(generationId: string, messageId: string): Promise<void> {
    if (this.inflight.has(generationId)) return;
    const controller = new AbortController();
    this.inflight.set(generationId, controller);
    try {
      for (let attempt = 0; attempt < this.backoff.maxAttempts; attempt++) {
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          this.store.setConnection(messageId, "offline", attempt);
          return;
        }
        this.store.setConnection(messageId, "reconnecting", attempt);
        if (attempt > 0) {
          const delay = Math.min(this.backoff.maxMs, this.backoff.baseMs * 2 ** (attempt - 1));
          await this.sleepImpl(delay * (0.7 + Math.random() * 0.6), controller.signal);
        }
        this.store.flush(); // the cursor must include everything already received
        const after = this.store.getMessage(messageId)?.lastSeq ?? -1;
        let res: Response;
        try {
          res = await this.fetchImpl(`/api/generations/${generationId}/events?after=${after}`, { signal: controller.signal });
        } catch {
          if (controller.signal.aborted) return;
          continue;
        }
        if (res.status === 404) {
          // The server never received the POST: re-POST with the same ids (D2).
          const body = this.bodies.get(generationId);
          if (!body) {
            this.store.updateMessage(messageId, {
              status: "error",
              connection: "idle",
              error: { kind: "unknown", message: "This reply was lost", retryable: false },
            });
            return;
          }
          this.inflight.delete(generationId);
          await this.post(body);
          return;
        }
        if (!res.ok) {
          this.failFromResponse(messageId, res, await safeJson(res));
          return;
        }
        const finished = await this.consume(res, generationId, messageId, controller.signal);
        if (finished || controller.signal.aborted) return;
        // Stream ended without a terminal event: try again, counting progress as a fresh start.
        if ((this.store.getMessage(messageId)?.lastSeq ?? -1) > after) attempt = -1;
      }
      this.store.setConnection(messageId, "offline", this.backoff.maxAttempts);
    } finally {
      if (this.inflight.get(generationId) === controller) this.inflight.delete(generationId);
    }
  }

  /** Resolves true when a terminal event arrived. */
  private async consume(res: Response, generationId: string, messageId: string, signal: AbortSignal): Promise<boolean> {
    this.store.setConnection(messageId, "streaming", 0);
    if (!res.body) return false;
    const reader = res.body.getReader();
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
      const event = parseRelayEvent(msg.data);
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
          : res.status === 401 || res.status === 403
            ? "auth"
            : res.status === 503
              ? "api_error"
              : "bad_request";
    const message =
      kind === "quota_exceeded"
        ? "You have used your whole budget on this instance"
        : kind === "rate_limited"
          ? "Too many messages, slow down a little"
          : res.status === 503
            ? "The server is restarting"
            : `Request failed (${res.status})`;
    this.store.updateMessage(messageId, {
      status: "error",
      connection: "idle",
      error: { kind, message, retryable: kind === "rate_limited" || res.status === 503, retryAfterMs, status: res.status },
    });
  }
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
