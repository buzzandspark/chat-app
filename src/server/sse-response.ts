import "server-only";
import { isTerminal, type RelayEvent } from "@relay/events";
import { encodeSse, SSE_HEADERS, SSE_KEEPALIVE } from "@relay/sse";
import type { EventStore } from "@relay/store";

export interface StreamOptions {
  /** D24 dropped-connection scenario: abort the response after this many events. */
  dropAfterEvents?: number;
  signal?: AbortSignal;
}

/** Streams buffered events after `after`, then live events, until the terminal event. */
export function streamGeneration(store: EventStore, generationId: string, after: number, options: StreamOptions = {}): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: () => void = () => {};
  let keepalive: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = 0;
      const close = () => {
        if (closed) return;
        closed = true;
        if (keepalive) clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the consumer
        }
      };
      const drop = () => {
        if (closed) return;
        closed = true;
        if (keepalive) clearInterval(keepalive);
        unsubscribe();
        controller.error(new Error("simulated connection drop"));
      };
      options.signal?.addEventListener("abort", close, { once: true });
      keepalive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(SSE_KEEPALIVE));
      }, 15_000);
      unsubscribe = store.subscribe(generationId, after, (event) => {
        if (closed) return;
        controller.enqueue(encoder.encode(encodeSse(event)));
        sent++;
        if (isTerminal(event)) close();
        else if (options.dropAfterEvents !== undefined && sent >= options.dropAfterEvents) drop();
      });
      if (store.get(generationId)?.terminal) close();
    },
    cancel() {
      closed = true;
      if (keepalive) clearInterval(keepalive);
      unsubscribe();
    },
  });
  return new Response(stream, { headers: SSE_HEADERS });
}

/** A single control event (snapshot) and then end of stream. */
export function singleEventResponse(event: RelayEvent): Response {
  return new Response(encodeSse(event), { headers: SSE_HEADERS });
}
