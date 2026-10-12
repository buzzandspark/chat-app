import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { RelayEvent, RelayEventBody } from "@relay/events";
import { createSseParser, parseRelayEvent } from "@relay/sse";
import { EventStore } from "@relay/store";
import { streamGeneration } from "./sse-response";

async function readAll(res: Response, generationId: string): Promise<RelayEvent[]> {
  const out: RelayEvent[] = [];
  const parser = createSseParser((m) => {
    const e = parseRelayEvent(m.data, generationId);
    if (e) out.push(e);
  });
  const text = await res.text();
  parser.push(text);
  parser.flush();
  return out;
}

function delta(index: number, text: string): RelayEventBody {
  return { type: "text_delta", index, text };
}

const started: RelayEventBody = { type: "started", chatId: "c", messageId: "m", userMessageId: "u", requestedModel: "claude-sonnet-5-5" };
const done: RelayEventBody = {
  type: "done",
  stopReason: "end_turn",
  servingModel: "claude-sonnet-5-5",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, estimated: false },
  timings: { received: 0 },
};

function textOf(events: RelayEvent[]): string {
  return events.map((e) => (e.type === "text_delta" ? e.text : "")).join("");
}

describe("streamGeneration", () => {
  it("replays a buffered slice coalesced, then batches live deltas, and loses nothing", async () => {
    const store = new EventStore();
    store.open("g");
    store.append("g", started);
    for (const ch of "hello ") store.append("g", delta(0, ch));
    const res = streamGeneration(store, "g", -1);
    // Live part: more deltas trickle in, then the terminal event.
    setTimeout(() => {
      for (const ch of "world") store.append("g", delta(0, ch));
      setTimeout(() => store.append("g", done), 30);
    }, 5);
    const events = await readAll(res, "g");
    expect(events[0]!.type).toBe("started");
    expect(textOf(events)).toBe("hello world");
    expect(events.at(-1)!.type).toBe("done");
    // The replayed run of six deltas arrived as one event carrying the last seq.
    const replayed = events.filter((e) => e.type === "text_delta" && e.text === "hello ");
    expect(replayed).toHaveLength(1);
    expect(replayed[0]!.seq).toBe(6);
    // Every seq the client needs is covered in order.
    const seqs = events.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });

  it("resumes from a cursor with exactly the events after it", async () => {
    const store = new EventStore();
    store.open("g2");
    store.append("g2", started);
    for (const ch of "abcdef") store.append("g2", delta(0, ch));
    store.append("g2", done);
    const events = await readAll(streamGeneration(store, "g2", 3), "g2");
    expect(textOf(events)).toBe("def");
    expect(events.at(-1)!.type).toBe("done");
  });

  it("a cursor that already covers the terminal event hears it again, never an empty response", async () => {
    const store = new EventStore();
    store.open("g3");
    store.append("g3", started);
    store.append("g3", done);
    const events = await readAll(streamGeneration(store, "g3", 1), "g3");
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("done");
  });

  it("the dropped-connection fault ends the response after N events with everything before them written", async () => {
    const store = new EventStore();
    store.open("g4");
    store.append("g4", started);
    const res = streamGeneration(store, "g4", -1, { dropAfterEvents: 4 });
    setTimeout(() => {
      for (const ch of "wxyz!") store.append("g4", delta(0, ch));
    }, 5);
    const events = await readAll(res, "g4");
    // started + 3 deltas were counted before the fourth event tripped the drop; all of them arrived.
    expect(textOf(events)).toBe("wxy");
    expect(events.at(-1)!.type).toBe("text_delta");
  });
});
