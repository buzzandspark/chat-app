import type { RelayEvent } from "./events";

// SSE encoder and decoder in one module so client and server cannot drift (D2).
// Hand-written because EventSource cannot POST, set headers, or defer to our backoff.

export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

export const SSE_KEEPALIVE = ": keepalive\n\n";

/**
 * One `data:` line per event (#49): the client reads the type and seq from the JSON, so the `event:`
 * and `id:` lines were pure overhead; a text or thinking delta also drops `generationId` and `t`,
 * which the client restores from the stream it is reading. JSON never contains a raw newline.
 */
export function encodeSse(event: RelayEvent): string {
  if (event.type === "text_delta" || event.type === "thinking_delta") {
    return `data: ${JSON.stringify({ type: event.type, seq: event.seq, index: event.index, text: event.text })}\n\n`;
  }
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Adjacent deltas of the same kind and block collapse into one event carrying the last seq. */
export function coalesceEvents(events: readonly RelayEvent[]): RelayEvent[] {
  const out: RelayEvent[] = [];
  for (const event of events) {
    const prev = out[out.length - 1];
    if (
      prev &&
      (event.type === "text_delta" || event.type === "thinking_delta") &&
      prev.type === event.type &&
      prev.index === event.index &&
      event.seq !== null &&
      prev.seq !== null
    ) {
      out[out.length - 1] = { ...prev, seq: event.seq, t: event.t, text: prev.text + event.text };
      continue;
    }
    out.push(event);
  }
  return out;
}

export interface SseMessage {
  event: string | null;
  id: string | null;
  data: string;
}

export interface SseParser {
  /** Feed decoded text; complete messages are dispatched synchronously. */
  push(chunk: string): void;
  /** Dispatch any trailing message that lacked a final blank line. */
  flush(): void;
}

// WHATWG EventSource parsing: CRLF, LF and lone CR line endings, chunks split anywhere.
// Callers decode bytes with a streaming TextDecoder so multi-byte splits are safe.
export function createSseParser(onMessage: (message: SseMessage) => void): SseParser {
  let buffer = "";
  let event: string | null = null;
  let id: string | null = null;
  let data: string[] = [];

  const dispatch = () => {
    if (data.length === 0 && event === null && id === null) return;
    onMessage({ event, id, data: data.join("\n") });
    event = null;
    id = null;
    data = [];
  };

  const handleLine = (line: string) => {
    if (line === "") {
      dispatch();
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    switch (field) {
      case "event":
        event = value;
        break;
      case "data":
        data.push(value);
        break;
      case "id":
        if (!value.includes("\0")) id = value;
        break;
      default:
        // `retry` and unknown fields are ignored; our client owns its backoff.
        break;
    }
  };

  return {
    push(chunk) {
      buffer += chunk;
      let start = 0;
      for (;;) {
        const nl = buffer.indexOf("\n", start);
        const cr = buffer.indexOf("\r", start);
        let end: number;
        let skip: number;
        if (nl === -1 && cr === -1) break;
        if (cr !== -1 && (nl === -1 || cr < nl)) {
          // CR, possibly CRLF. A CR at the very end of the buffer might be the
          // first half of CRLF split across chunks; wait for more input.
          if (cr === buffer.length - 1) break;
          end = cr;
          skip = buffer[cr + 1] === "\n" ? 2 : 1;
        } else {
          end = nl;
          skip = 1;
        }
        handleLine(buffer.slice(start, end));
        start = end + skip;
      }
      buffer = buffer.slice(start);
    },
    flush() {
      if (buffer.length > 0) {
        handleLine(buffer);
        buffer = "";
      }
      dispatch();
    },
  };
}

/** `generationId` fills in what a compact delta left out (the caller knows which stream it reads). */
export function parseRelayEvent(data: string, generationId?: string): RelayEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === "object" && parsed !== null && "type" in parsed && "seq" in parsed) {
      const event = parsed as RelayEvent & { generationId?: string; t?: number };
      if (event.generationId === undefined) {
        if (generationId === undefined) return null;
        event.generationId = generationId;
      }
      if (event.t === undefined) event.t = 0;
      return event as RelayEvent;
    }
    return null;
  } catch {
    return null;
  }
}
