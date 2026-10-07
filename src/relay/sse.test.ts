import { describe, expect, it } from "vitest";
import { coalesceEvents, createSseParser, encodeSse, parseRelayEvent, type SseMessage } from "./sse";
import type { RelayEvent } from "./events";

const sample: RelayEvent = { type: "text_delta", seq: 3, generationId: "g1", t: 120, index: 0, text: "héllo\nworld" };
const control: RelayEvent = { type: "started", seq: 0, generationId: "g1", t: 0, chatId: "c", messageId: "m", userMessageId: "u", requestedModel: "claude-sonnet-5-5" };

function collect(chunks: string[], flush = true): SseMessage[] {
  const out: SseMessage[] = [];
  const parser = createSseParser((m) => out.push(m));
  for (const c of chunks) parser.push(c);
  if (flush) parser.flush();
  return out;
}

describe("sse codec", () => {
  it("round-trips a delta compactly: one data line, the stream's generation id restored by the reader (#49)", () => {
    const wire = encodeSse(sample);
    expect(wire).toMatch(/^data: /);
    expect(wire).not.toContain("event:");
    expect(wire).not.toContain("generationId");
    const [msg] = collect([wire]);
    expect(parseRelayEvent(msg!.data, "g1")).toEqual({ ...sample, t: 0 });
    // Without the reader's generation id a compact delta cannot be placed.
    expect(parseRelayEvent(msg!.data)).toBeNull();
  });

  it("control events keep every field", () => {
    const [msg] = collect([encodeSse(control)]);
    expect(parseRelayEvent(msg!.data)).toEqual(control);
  });

  it("handles chunks split anywhere, including inside CRLF", () => {
    const wire = encodeSse(sample).replace(/\n/g, "\r\n");
    const a = wire.slice(0, 10);
    const b = wire.slice(10, wire.indexOf("\r\n\r\n") + 1); // ends with a lone CR
    const c = wire.slice(wire.indexOf("\r\n\r\n") + 1);
    const out = collect([a, b, c], false);
    expect(out).toHaveLength(1);
    expect(parseRelayEvent(out[0]!.data, "g1")).toEqual({ ...sample, t: 0 });
  });

  it("dispatches several messages from one chunk and ignores comments", () => {
    const wire = `: keepalive\n\n${encodeSse(sample)}${encodeSse({ ...sample, seq: 4 })}`;
    const out = collect([wire], false);
    expect(out.map((m) => parseRelayEvent(m.data, "g1")?.seq)).toEqual([3, 4]);
  });

  it("coalesces adjacent deltas of one block into one event carrying the last seq", () => {
    const merged = coalesceEvents([
      control,
      sample,
      { ...sample, seq: 4, text: " again" },
      { ...sample, seq: 5, index: 1, text: "other block" },
      { type: "thinking_delta", seq: 6, generationId: "g1", t: 0, index: 2, text: "t" },
    ]);
    expect(merged.map((e) => e.seq)).toEqual([0, 4, 5, 6]);
    expect(merged[1]).toMatchObject({ type: "text_delta", seq: 4, text: "héllo\nworld again" });
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
