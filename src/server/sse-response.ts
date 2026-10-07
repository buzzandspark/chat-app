import "server-only";
import { Readable } from "node:stream";
import { constants as zlibConstants, createGzip } from "node:zlib";
import { isTerminal, type RelayEvent } from "@relay/events";
import { coalesceEvents, encodeSse, SSE_HEADERS, SSE_KEEPALIVE } from "@relay/sse";
import type { EventStore } from "@relay/store";
import { streamClosed, streamOpened } from "./streams";

/** Live deltas are held this long and sent together (#49); control and terminal events go at once. */
const BATCH_MS = 16;

export interface StreamOptions {
  /** D24 dropped-connection scenario: abort the response after this many events. */
  dropAfterEvents?: number;
  /** D24 stalled-stream scenario: after this many events send nothing more, not even keepalives, and never close (a half-open socket). */
  stallAfterEvents?: number;
  signal?: AbortSignal;
  /** The request's Accept-Encoding: with gzip, the stream is compressed and flushed per batch (#49). */
  acceptEncoding?: string | null;
}

/**
 * Streams buffered events after `after`, then live events, until the terminal event. The replayed
 * slice is coalesced (one delta per run of text), live deltas are batched per 16 ms, and the whole
 * stream is gzipped when the client accepts it (#49).
 */
export function streamGeneration(store: EventStore, generationId: string, after: number, options: StreamOptions = {}): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: () => void = () => {};
  let keepalive: ReturnType<typeof setInterval> | null = null;
  streamOpened();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = 0;
      let stalled = false;
      let replaying = true;
      let pending: RelayEvent[] = [];
      let batchTimer: ReturnType<typeof setTimeout> | null = null;
      const write = (events: RelayEvent[]) => {
        for (const event of coalesceEvents(events)) controller.enqueue(encoder.encode(encodeSse(event)));
      };
      const flush = () => {
        if (batchTimer) clearTimeout(batchTimer);
        batchTimer = null;
        if (pending.length === 0 || closed) return;
        const batch = pending;
        pending = [];
        write(batch);
      };
      const close = () => {
        if (closed) return;
        flush();
        closed = true;
        if (keepalive) clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the consumer
        }
        streamClosed();
      };
      // D24 dropped connection: end the response without a terminal event, as a
      // proxy timeout or a lost radio does. The client resumes from its last seq.
      const drop = () => close();
      options.signal?.addEventListener("abort", close, { once: true });
      keepalive = setInterval(() => {
        if (!closed && !stalled) controller.enqueue(encoder.encode(SSE_KEEPALIVE));
      }, 15_000);
      unsubscribe = store.subscribe(generationId, after, (event) => {
        if (closed || stalled) return;
        sent++;
        const control = event.type !== "text_delta" && event.type !== "thinking_delta";
        pending.push(event);
        if (replaying) {
          // The replayed slice is delivered synchronously by subscribe(); it is written once, coalesced, below.
        } else if (control || isTerminal(event)) {
          flush();
        } else if (!batchTimer) {
          batchTimer = setTimeout(flush, BATCH_MS);
        }
        if (isTerminal(event)) close();
        else if (options.dropAfterEvents !== undefined && sent >= options.dropAfterEvents) drop();
        else if (options.stallAfterEvents !== undefined && sent >= options.stallAfterEvents) stalled = true;
      });
      replaying = false;
      flush();
      const buffer = store.get(generationId);
      if (buffer?.terminal) {
        // A client whose cursor already covers the terminal event must still hear it again: an empty
        // response here looked like a cut stream and sent the client round its whole backoff loop.
        const last = buffer.events[buffer.events.length - 1];
        if (sent === 0 && last) controller.enqueue(encoder.encode(encodeSse(last)));
        close();
      }
    },
    cancel() {
      if (closed) return;
      closed = true;
      if (keepalive) clearInterval(keepalive);
      unsubscribe();
      streamClosed();
    },
  });
  return sseResponse(stream, options.acceptEncoding);
}

/** A single control event (snapshot) and then end of stream. */
export function singleEventResponse(event: RelayEvent, acceptEncoding?: string | null): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(encodeSse(event)));
      controller.close();
    },
  });
  return sseResponse(stream, acceptEncoding);
}

/** gzip with a sync flush per chunk, so every batch leaves the process as soon as it is written. */
function sseResponse(stream: ReadableStream<Uint8Array>, acceptEncoding: string | null | undefined): Response {
  if (!acceptEncoding || !/\bgzip\b/.test(acceptEncoding)) return new Response(stream, { headers: SSE_HEADERS });
  const gzip = createGzip({ flush: zlibConstants.Z_SYNC_FLUSH });
  Readable.fromWeb(stream as import("node:stream/web").ReadableStream<Uint8Array>).pipe(gzip);
  const body = Readable.toWeb(gzip) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { headers: { ...SSE_HEADERS, "content-encoding": "gzip" } });
}
