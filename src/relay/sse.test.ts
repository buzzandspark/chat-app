import { describe, expect, it } from "vitest";
import { createSseParser, encodeSse, parseRelayEvent, type SseMessage } from "./sse";
import type { RelayEvent } from "./events";

const sample: RelayEvent = { type: "text_delta", seq: 3, generationId: "g1", t: 120, index: 0, text: "héllo\nworld" };

function collect(chunks: string[], flush = true): SseMessage[] {
  const out: SseMessage[] = [];
  const parser = createSseParser((m) => out.push(m));
  for (const c of chunks) parser.push(c);
  if (flush) parser.flush();
  return out;
}

describe("sse codec", () => {
  it("round-trips an event", () => {
    const wire = encodeSse(sample);
    expect(wire).toMatch(/^event: text_delta\nid: 3\ndata: /);
    const [msg] = collect([wire]);
    expect(msg?.event).toBe("text_delta");
    expect(msg?.id).toBe("3");
    expect(parseRelayEvent(msg!.data)).toEqual(sample);
  });

  it("omits id for control events", () => {
    const wire = encodeSse({ ...sample, seq: null });
    expect(wire).not.toContain("id:");
  });

  it("handles chunks split anywhere, including inside CRLF", () => {
    const wire = encodeSse(sample).replace(/\n/g, "\r\n");
    const a = wire.slice(0, 10);
    const b = wire.slice(10, wire.indexOf("\r\n\r\n") + 1); // ends with a lone CR
    const c = wire.slice(wire.indexOf("\r\n\r\n") + 1);
    const out = collect([a, b, c], false);
    expect(out).toHaveLength(1);
    expect(parseRelayEvent(out[0]!.data)).toEqual(sample);
  });

  it("dispatches several messages from one chunk and ignores comments", () => {
    const wire = `: keepalive\n\n${encodeSse(sample)}${encodeSse({ ...sample, seq: 4 })}`;
    const out = collect([wire], false);
    expect(out.map((m) => m.id)).toEqual(["3", "4"]);
  });

  it("returns null for malformed data", () => {
    expect(parseRelayEvent("{not json")).toBeNull();
    expect(parseRelayEvent('{"type":"x"}')).toBeNull();
  });

  it("flushes a trailing message without a final blank line", () => {
    const wire = encodeSse(sample).trimEnd();
    expect(collect([wire])).toHaveLength(1);
  });
});
