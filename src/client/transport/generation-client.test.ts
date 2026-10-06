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
});
