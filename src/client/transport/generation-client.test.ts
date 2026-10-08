import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RelayEvent } from "@relay/events";
import { encodeSse } from "@relay/sse";
import { ChatStore, textOf } from "../store/chat-store";
import { GenerationClient } from "./generation-client";

type Handler = (url: string, init?: RequestInit) => Promise<Response> | Response;

function sseResponse(events: RelayEvent[], opts: { cutAfter?: number } = {}): Response {
  const encoder = new TextEncoder();
  let i = 0;
  // Pull-based so each read delivers one chunk; erroring a stream discards its
  // queue, which a real network never does.
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (opts.cutAfter !== undefined && i >= opts.cutAfter && i < events.length) {
        controller.error(new Error("cut"));
        return;
      }
      if (i >= events.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(encodeSse(events[i]!)));
      i++;
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function makeEvents(generationId: string, messageId: string, text: string): RelayEvent[] {
  const out: RelayEvent[] = [
    { type: "started", seq: 0, generationId, t: 0, chatId: "c1", messageId, userMessageId: "u", requestedModel: "claude-sonnet-5-5" },
    { type: "message_start", seq: 1, generationId, t: 1, apiMessageId: "m", model: "claude-sonnet-5-5", inputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, inputTransformations: [] },
    { type: "block_start", seq: 2, generationId, t: 2, index: 0, block: "text" },
  ];
  let seq = 3;
  for (const ch of text) out.push({ type: "text_delta", seq: seq++, generationId, t: seq, index: 0, text: ch });
  out.push({ type: "block_stop", seq: seq++, generationId, t: seq, index: 0 });
  out.push({
    type: "done",
    seq: seq++,
    generationId,
    t: seq,
    stopReason: "end_turn",
    servingModel: "claude-sonnet-5-5",
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, estimated: false },
    timings: { received: 0 },
  });
  return out;
}

let store: ChatStore;
let calls: Array<{ url: string; method: string; body?: Record<string, unknown> }>;

function makeClient(handler: Handler) {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
    return handler(url, init);
  };
  return new GenerationClient(store, { fetch: fetchImpl, backoff: { baseMs: 1, maxMs: 2, maxAttempts: 5 }, sleep: async () => {} });
}

async function settle(id: string, timeout = 2000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    store.flush();
    const m = store.getMessage(id);
    if (m && m.status !== "streaming") return m;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("did not settle");
}

beforeEach(() => {
  store = new ChatStore({ schedule: (cb) => setTimeout(cb, 0) as unknown as number, cancel: (h) => clearTimeout(h) });
  calls = [];
});
afterEach(() => vi.restoreAllMocks());

describe("GenerationClient", () => {
  it("drops a silent connection after idleMs and resumes from the last seq", async () => {
    let posts = 0;
    const client = (() => {
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, method: init?.method ?? "GET", body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
        if (url === "/api/chat") {
          posts++;
          const body = JSON.parse(String(init?.body)) as { generationId: string; assistantMessageId: string };
          const events = makeEvents(body.generationId, body.assistantMessageId, "hi");
          // The first two events, then silence: a half-open socket.
          const encoder = new TextEncoder();
          let i = 0;
          const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
              if (i < 2) {
                controller.enqueue(encoder.encode(encodeSse(events[i]!)));
                i++;
                return;
              }
              return new Promise(() => {});
            },
          });
          return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
        }
        const m = /\/api\/generations\/(.+)\/events\?after=(\d+|-1)/.exec(url)!;
        const after = Number(m[2]);
        const id = store.messageIdForGeneration(m[1]!)!;
        return sseResponse(makeEvents(m[1]!, id, "hi").filter((e) => e.seq !== null && e.seq > after));
      };
      return new GenerationClient(store, { fetch: fetchImpl, backoff: { baseMs: 1, maxMs: 2, maxAttempts: 5 }, sleep: async () => {}, idleMs: 30 });
    })();
    const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
    const m = await settle(assistantMessageId, 5000);
    expect(m.status).toBe("done");
    expect(textOf(m.blocks)).toBe("hi");
    expect(posts).toBe(1);
    const resumes = calls.filter((c) => c.url.includes("/events?after="));
    expect(resumes).toHaveLength(1);
    expect(resumes[0]!.url).toMatch(/after=1$/);
  });

  it("retry carries the user text so a refused first send can be retried", async () => {
    const client = makeClient((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { generationId: string; assistantMessageId: string };
      return sseResponse(makeEvents(body.generationId, body.assistantMessageId, "ok"));
    });
    const { assistantMessageId } = client.retry({ chatId: "c1", userMessageId: "u1", text: "again", model: "claude-sonnet-5-5", thinking: { harder: false } });
    await settle(assistantMessageId);
    expect(calls[0]!.body).toMatchObject({ messageId: "u1", text: "again" });
  });

  it("streams a POST into the store with timings", async () => {
    const client = makeClient((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { generationId: string; assistantMessageId: string };
      return sseResponse(makeEvents(body.generationId, body.assistantMessageId, "hi"));
    });
    const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
    const m = await settle(assistantMessageId);
    expect(m.status).toBe("done");
    expect(textOf(m.blocks)).toBe("hi");
    expect(m.timings?.client?.sent).toBeDefined();
    expect(m.timings?.client?.firstByte).toBeDefined();
    expect(m.timings?.client?.done).toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it("POST failure, GET 404, re-POST yields exactly one generation with the same ids", async () => {
    let posts = 0;
    const client = makeClient((url, init) => {
      if (url === "/api/chat") {
        posts++;
        if (posts === 1) throw new TypeError("fetch failed");
        const body = JSON.parse(String(init?.body)) as { generationId: string; assistantMessageId: string };
        return sseResponse(makeEvents(body.generationId, body.assistantMessageId, "ok"));
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    });
    const { assistantMessageId, generationId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
    const m = await settle(assistantMessageId);
    expect(m.status).toBe("done");
    expect(textOf(m.blocks)).toBe("ok");
    const postBodies = calls.filter((c) => c.method === "POST").map((c) => c.body!.generationId);
    expect(postBodies).toEqual([generationId, generationId]);
    expect(calls.some((c) => c.url.startsWith(`/api/generations/${generationId}/events?after=-1`))).toBe(true);
  });

  it("a POST that keeps failing while the GET answers 404 re-POSTs with growing backoff, then ends as a network error", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5); // no jitter: the schedule is exactly base * 2^(attempt - 1)
    try {
      const posts: number[] = [];
      const fetchImpl: typeof fetch = async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (url === "/api/chat") {
          posts.push(Date.now());
          // A guard, so a regression fails the assertions instead of spinning forever in microtasks.
          if (posts.length > 20) return new Response("{}", { status: 400 });
          throw new TypeError("fetch failed");
        }
        return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
      };
      // The real sleep, on fake timers: the delays between POSTs are what the backoff schedule says.
      const client = new GenerationClient(store, { fetch: fetchImpl, backoff: { baseMs: 500, maxMs: 8000, maxAttempts: 10 } });
      const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
      await vi.runAllTimersAsync();
      store.flush();
      const m = store.getMessage(assistantMessageId)!;
      expect(posts).toHaveLength(4); // the first POST and three re-POSTs
      const gaps = posts.slice(1).map((t, i) => t - posts[i]!);
      expect(gaps).toEqual([0, 500, 1000]);
      expect(m.status).toBe("error");
      expect(m.connection).toBe("idle");
      expect(m.error).toMatchObject({ kind: "network", retryable: true });
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes after a mid-stream drop from the last seq with no duplicated or missing text", async () => {
    const client = makeClient((url, init) => {
      if (url === "/api/chat") {
        const body = JSON.parse(String(init?.body)) as { generationId: string; assistantMessageId: string };
        return sseResponse(makeEvents(body.generationId, body.assistantMessageId, "abcdef"), { cutAfter: 6 });
      }
      const m = /\/api\/generations\/(.+)\/events\?after=(-?\d+)/.exec(url)!;
      const all = makeEvents(m[1]!, store.messageIdForGeneration(m[1]!)!, "abcdef");
      return sseResponse(all.filter((e) => e.seq! > Number(m[2])));
    });
    const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
    const m = await settle(assistantMessageId);
    expect(textOf(m.blocks)).toBe("abcdef");
    expect(m.status).toBe("done");
    const resumes = calls.filter((c) => c.url.includes("/events?after="));
    expect(resumes).toHaveLength(1);
    expect(resumes[0]!.url.endsWith("after=5")).toBe(true);
  });

  it("applies a snapshot returned by the resume path", async () => {
    const client = makeClient((url, init) => {
      if (url === "/api/chat") {
        const body = JSON.parse(String(init?.body)) as { generationId: string; assistantMessageId: string };
        return sseResponse(makeEvents(body.generationId, body.assistantMessageId, "abc"), { cutAfter: 4 });
      }
      const gen = /\/api\/generations\/(.+)\/events/.exec(url)![1]!;
      const snapshot: RelayEvent = {
        type: "snapshot",
        seq: null,
        generationId: gen,
        t: 0,
        status: "interrupted",
        message: {
          id: store.messageIdForGeneration(gen)!,
          chatId: "c1",
          role: "assistant",
          content: [{ type: "text", text: "a", citations: null }],
          status: "interrupted",
          requestedModel: "claude-sonnet-5-5",
          servingModel: "claude-sonnet-5-5",
          stopReason: null,
          refusal: null,
          error: null,
          timings: null,
          generationId: gen,
        },
      };
      return sseResponse([snapshot]);
    });
    const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
    const m = await settle(assistantMessageId);
    expect(m.status).toBe("interrupted");
    expect(textOf(m.blocks)).toBe("a");
  });

  it("surfaces HTTP failures with the right error kind", async () => {
    const client = makeClient(() => new Response(JSON.stringify({ error: "quota_exceeded" }), { status: 402 }));
    const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
    const m = await settle(assistantMessageId);
    expect(m.status).toBe("error");
    expect(m.error?.kind).toBe("quota_exceeded");
  });

  it("gives up after max attempts and marks offline", async () => {
    let posts = 0;
    const client = makeClient((url) => {
      if (url === "/api/chat") {
        posts++;
        throw new TypeError("fetch failed");
      }
      throw new TypeError("fetch failed");
    });
    const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
    const started = Date.now();
    while (Date.now() - started < 2000) {
      const m = store.getMessage(assistantMessageId)!;
      if (m.connection === "offline") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(store.getMessage(assistantMessageId)!.connection).toBe("offline");
    expect(posts).toBe(1);
  });

  // Events are built from the ids the client chose, captured from the POST body.
  function eventsFromPost(init: RequestInit | undefined, text: string): RelayEvent[] {
    const body = JSON.parse(String(init?.body)) as { generationId: string; assistantMessageId: string };
    return makeEvents(body.generationId, body.assistantMessageId, text);
  }

  it("keeps trying through a 5xx on the resume GET instead of abandoning the reply", async () => {
    let events: RelayEvent[] = [];
    let gets = 0;
    const client = makeClient((url, init) => {
      if (url === "/api/chat") {
        events = eventsFromPost(init, "hello");
        return sseResponse(events, { cutAfter: 4 });
      }
      gets++;
      if (gets === 1) return new Response(JSON.stringify({ error: "draining" }), { status: 503 });
      return sseResponse(events.slice(4));
    });
    const { assistantMessageId } = client.send({ chatId: "c1", text: "hi", model: "claude-sonnet-5-5", thinking: { harder: false } });
    const m = await settle(assistantMessageId);
    expect(m.status).toBe("done");
    expect(textOf(m.blocks)).toBe("hello");
    expect(gets).toBe(2);
  });

  it("a 404 after the server accepted the generation means the chat is gone, not a lost POST", async () => {
    const client = makeClient((url, init) => {
      if (url === "/api/chat") return sseResponse(eventsFromPost(init, "hello"), { cutAfter: 4 });
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    });
    const { assistantMessageId } = client.send({ chatId: "c1", text: "hi", model: "claude-sonnet-5-5", thinking: { harder: false } });
    const m = await settle(assistantMessageId);
    expect(m.status).toBe("error");
    expect(m.error?.kind).toBe("gone");
    expect(calls.filter((c) => c.url === "/api/chat")).toHaveLength(1);
  });

  it("attach does nothing for a reply that already finished here", async () => {
    const client = makeClient((_url, init) => sseResponse(eventsFromPost(init, "ok")));
    const { assistantMessageId, generationId } = client.send({ chatId: "c1", text: "hi", model: "claude-sonnet-5-5", thinking: { harder: false } });
    await settle(assistantMessageId);
    const before = calls.length;
    client.attach(generationId, assistantMessageId);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.length).toBe(before);
    expect(store.getMessage(assistantMessageId)?.connection).toBe("idle");
  });

  it("the server accepting the POST fires onAccepted; a refused POST never does", async () => {
    let accepted = 0;
    const client = makeClient((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { text?: string };
      if (body.text === "no") return new Response(JSON.stringify({ error: "rate_limited", retryAfterMs: 1 }), { status: 429 });
      return sseResponse(eventsFromPost(init, "ok"));
    });
    const refused = client.send({ chatId: "c1", text: "no", model: "claude-sonnet-5-5", thinking: { harder: false } }, { onAccepted: () => accepted++ });
    await settle(refused.assistantMessageId);
    expect(accepted).toBe(0);
    const ok = client.send({ chatId: "c1", text: "yes", model: "claude-sonnet-5-5", thinking: { harder: false } }, { onAccepted: () => accepted++ });
    await settle(ok.assistantMessageId);
    expect(accepted).toBe(1);
  });

  it("a refused Regenerate's retry replaces from the old reply, through any number of refused retries", async () => {
    let refuse = 2;
    const client = makeClient((_url, init) => {
      if (refuse-- > 0) return new Response(JSON.stringify({ error: "rate_limited", retryAfterMs: 1 }), { status: 429 });
      return sseResponse(eventsFromPost(init, "ok"));
    });
    const input = { chatId: "c1", userMessageId: "u1", model: "claude-sonnet-5-5", thinking: { harder: false } } as const;
    const first = client.retry({ ...input, replaceFrom: "old-reply" });
    const failed = await settle(first.assistantMessageId);
    expect(failed.error?.kind).toBe("rate_limited");
    // The server never stored the failed reply, so replacing from it would keep the old one.
    expect(client.retryReplaceFrom(failed)).toBe("old-reply");
    const second = client.retry({ ...input, replaceFrom: client.retryReplaceFrom(failed) });
    const failedAgain = await settle(second.assistantMessageId);
    expect(client.retryReplaceFrom(failedAgain)).toBe("old-reply");
    const third = client.retry({ ...input, replaceFrom: client.retryReplaceFrom(failedAgain) });
    expect((await settle(third.assistantMessageId)).status).toBe("done");
    expect(calls.map((c) => c.body!.replaceFromMessageId)).toEqual(["old-reply", "old-reply", "old-reply"]);
  });

  it("a refused Edit's retry replaces from the edited message; a refused plain send's from the reply itself", async () => {
    const client = makeClient(() => new Response(JSON.stringify({ error: "rate_limited", retryAfterMs: 1 }), { status: 429 }));
    const edit = client.send({ chatId: "c1", text: "edited", model: "claude-sonnet-5-5", thinking: { harder: false }, replaceFrom: "u-original" });
    expect(client.retryReplaceFrom(await settle(edit.assistantMessageId))).toBe("u-original");
    const plain = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
    expect(client.retryReplaceFrom(await settle(plain.assistantMessageId))).toBe(plain.assistantMessageId);
  });

  it("a reply the server accepted is replaced from itself, even when its own request was a Regenerate", async () => {
    const client = makeClient((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { generationId: string; assistantMessageId: string };
      const events = makeEvents(body.generationId, body.assistantMessageId, "x").slice(0, 3);
      events.push({ type: "error", seq: 3, generationId: body.generationId, t: 3, error: { kind: "overloaded", message: "Overloaded", retryable: true } });
      return sseResponse(events);
    });
    // Errored mid-stream: the server applied the replace and keeps this reply's row.
    const regen = client.retry({ chatId: "c1", userMessageId: "u1", model: "claude-sonnet-5-5", thinking: { harder: false }, replaceFrom: "old-reply" });
    const failed = await settle(regen.assistantMessageId);
    expect(failed.status).toBe("error");
    expect(client.retryReplaceFrom(failed)).toBe(regen.assistantMessageId);
    // A reply loaded from the server (no body here) is its own target too.
    expect(client.retryReplaceFrom({ id: "saved", generationId: "g-saved" })).toBe("saved");
  });

  it("resumeAll cuts a backoff sleep short and retries at once", async () => {
    let events: RelayEvent[] = [];
    let gets = 0;
    let release: (() => void) | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, method: init?.method ?? "GET" });
      if (url === "/api/chat") {
        events = eventsFromPost(init, "hello");
        return sseResponse(events, { cutAfter: 4 });
      }
      gets++;
      if (gets === 1) throw new Error("network");
      return sseResponse(events.slice(4));
    };
    // The backoff sleep only ends when its signal aborts (a real timer would be 60 s here).
    const client = new GenerationClient(store, {
      fetch: fetchImpl,
      backoff: { baseMs: 60_000, maxMs: 60_000, maxAttempts: 5 },
      sleep: (_ms, signal) =>
        new Promise<void>((resolve) => {
          release = resolve;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        }),
    });
    const { assistantMessageId } = client.send({ chatId: "c1", text: "hi", model: "claude-sonnet-5-5", thinking: { harder: false } });
    for (let i = 0; i < 100 && release === null; i++) await new Promise((r) => setTimeout(r, 2));
    expect(release).not.toBeNull();
    client.resumeAll();
    const m = await settle(assistantMessageId);
    expect(m.status).toBe("done");
    expect(textOf(m.blocks)).toBe("hello");
  });

  // A request into a half-open socket: no headers ever, until its signal aborts it.
  function hang(init?: RequestInit): Promise<Response> {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      const fail = () => reject(new DOMException("aborted", "AbortError"));
      if (signal?.aborted) fail();
      else signal?.addEventListener("abort", fail, { once: true });
    });
  }

  describe("before response headers", () => {
    let sent: Array<{ url: string; at: number; signal: AbortSignal | null | undefined }>;
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(0); // request times read as ms since the send
      sent = [];
    });
    afterEach(() => vi.useRealTimers());

    /** `answer` decides each request in order (POST, then resume GETs); PATCHes for timings just succeed. */
    function headersClient(answer: (url: string, init: RequestInit | undefined, n: number) => Promise<Response> | Response) {
      const fetchImpl: typeof fetch = async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        if (init?.method === "PATCH") return new Response("{}");
        sent.push({ url, at: Date.now(), signal: init?.signal });
        return answer(url, init, sent.length);
      };
      return new GenerationClient(store, { fetch: fetchImpl, backoff: { baseMs: 60_000, maxMs: 60_000, maxAttempts: 5 }, headersMs: 10_000 });
    }
    function resumed(url: string): Response {
      const gen = /\/api\/generations\/(.+)\/events/.exec(url)![1]!;
      return sseResponse(makeEvents(gen, store.messageIdForGeneration(gen)!, "hi"));
    }

    it("a POST with no headers is dropped after headersMs and the reply resumes over the GET", async () => {
      const client = headersClient((url, init) => (url === "/api/chat" ? hang(init) : resumed(url)));
      const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
      await vi.advanceTimersByTimeAsync(9_999);
      expect(sent).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(sent).toHaveLength(2);
      expect(sent[0]!.signal?.aborted).toBe(true);
      expect(sent[1]).toMatchObject({ at: 10_000 });
      expect(sent[1]!.url).toMatch(/\/events\?after=-1$/);
      await vi.runAllTimersAsync();
      store.flush();
      const m = store.getMessage(assistantMessageId)!;
      expect(m.status).toBe("done");
      expect(textOf(m.blocks)).toBe("hi");
    });

    it("resumeAll while a POST or a GET waits for headers drops it and retries at once, with no backoff sleep", async () => {
      // The POST and the first GET hang; the second GET answers.
      const client = headersClient((url, init, n) => (n <= 2 ? hang(init) : resumed(url)));
      const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
      await vi.advanceTimersByTimeAsync(1_000);
      client.resumeAll();
      await vi.advanceTimersByTimeAsync(0);
      expect(sent.map((s) => s.at)).toEqual([0, 1_000]);
      await vi.advanceTimersByTimeAsync(1_000);
      client.resumeAll();
      await vi.advanceTimersByTimeAsync(0);
      // The nudged GET is followed by another at once, not after the 60 s backoff.
      expect(sent.map((s) => s.at)).toEqual([0, 1_000, 2_000]);
      expect(sent.slice(0, 2).every((s) => s.signal?.aborted)).toBe(true);
      await vi.runAllTimersAsync();
      store.flush();
      expect(store.getMessage(assistantMessageId)!.status).toBe("done");
    });

    it("the loop giving up while a POST waits for headers cancels it, retries nothing and leaves no timer", async () => {
      const client = headersClient((_url, init) => hang(init));
      const { generationId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
      await vi.advanceTimersByTimeAsync(1_000);
      // Nothing public aborts the loop's controller; this is what a give-up (stop, unmount) would do.
      const inflight = (client as unknown as { inflight: Map<string, { controller: AbortController }> }).inflight;
      inflight.get(generationId)!.controller.abort();
      await vi.advanceTimersByTimeAsync(0);
      store.flush();
      expect(sent[0]!.signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await vi.runAllTimersAsync();
      expect(sent).toHaveLength(1);
    });
  });

  it("resumeAll applies events a hidden tab left queued, so a reply that finished there is not resumed", async () => {
    // A hidden tab: no animation frames, so nothing flushes on its own.
    store = new ChatStore({ schedule: () => 1, cancel: () => {} });
    const client = makeClient((url, init) => (url === "/api/chat" ? sseResponse(eventsFromPost(init, "ok")) : new Response("{}")));
    const { assistantMessageId } = client.send({ chatId: "c1", text: "q", model: "claude-sonnet-5-5", thinking: { harder: false } });
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getMessage(assistantMessageId)!.status).toBe("streaming"); // `done` is still queued
    client.resumeAll();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getMessage(assistantMessageId)!.status).toBe("done");
    expect(calls.some((c) => c.url.includes("/events?after="))).toBe(false);
  });
});
