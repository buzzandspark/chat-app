import type { RelayEvent } from "./events";

/**
 * Server-Sent Events encoder and decoder sharing one module (D2) so the
 * client decoder and the server encoder cannot drift. Hand-written because
 * `EventSource` cannot POST, cannot set headers, and auto-reconnects on its
 * own schedule.
 */

export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

export const SSE_KEEPALIVE = ": keepalive\n\n";

export function encodeSse(event: RelayEvent): string {
  const id = event.seq === null ? "" : `id: ${event.seq}\n`;
  // JSON never contains a raw newline, so one data line is enough.
  return `event: ${event.type}\n${id}data: ${JSON.stringify(event)}\n\n`;
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

/**
 * Incremental parser per the WHATWG EventSource spec: fields are `name: value`,
 * lines starting with `:` are comments, a blank line dispatches. Handles CRLF,
 * LF, and lone CR line endings and chunks split anywhere, including inside a
 * multi-byte sequence (callers decode with a streaming TextDecoder).
 */
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

export function parseRelayEvent(data: string): RelayEvent | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      "generationId" in parsed &&
      "seq" in parsed
    ) {
      return parsed as RelayEvent;
    }
    return null;
  } catch {
    return null;
  }
}
