import { describe, expect, it } from "vitest";
import type { RelayEvent, RelayEventBody } from "@relay/events";
import { ChatStore, createMessageState, textOf } from "./chat-store";

function makeStore() {
  const scheduled: Array<() => void> = [];
  const store = new ChatStore({
    schedule: (cb) => {
      scheduled.push(cb);
      return scheduled.length;
    },
    cancel: () => {},
    now: () => 1000,
  });
  const runFrame = () => {
    const cbs = scheduled.splice(0);
    for (const cb of cbs) cb();
  };
  return { store, runFrame, scheduled };
}

function seed(store: ChatStore) {
  store.addMessage(createMessageState({ id: "a1", chatId: "c1", role: "assistant", status: "streaming", generationId: "g1", connection: "streaming" }));
}

const ev = (seq: number | null, body: RelayEventBody): RelayEvent => ({ seq, generationId: "g1", t: 0, ...body }) as RelayEvent;

describe("ChatStore", () => {
  it("batches producer events per frame and publishes one state per touched message", () => {
    const { store, runFrame } = makeStore();
    seed(store);
    let renders = 0;
    store.subscribeMessage("a1", () => renders++);
    store.enqueue(ev(0, { type: "started", chatId: "c1", messageId: "a1", userMessageId: "u1", requestedModel: "claude-sonnet-5-5" }));
    store.enqueue(ev(1, { type: "block_start", index: 0, block: "text" }));
    store.enqueue(ev(2, { type: "text_delta", index: 0, text: "hel" }));
    store.enqueue(ev(3, { type: "text_delta", index: 0, text: "lo" }));
    expect(renders).toBe(0);
    expect(textOf(store.getMessage("a1")!.blocks)).toBe("");
    runFrame();
    expect(renders).toBe(1);
    expect(textOf(store.getMessage("a1")!.blocks)).toBe("hello");
    expect(store.getMessage("a1")!.lastSeq).toBe(3);
  });

  it("dedupes producer events by seq and never applies them out of order", () => {
    const { store, runFrame } = makeStore();
    seed(store);
    store.enqueue(ev(1, { type: "block_start", index: 0, block: "text" }));
    store.enqueue(ev(2, { type: "text_delta", index: 0, text: "a" }));
    store.enqueue(ev(2, { type: "text_delta", index: 0, text: "a" }));
    store.enqueue(ev(1, { type: "text_delta", index: 0, text: "zzz" }));
    runFrame();
    expect(textOf(store.getMessage("a1")!.blocks)).toBe("a");
  });

  it("always applies control events and flushes pending producer events first", () => {
    const { store, scheduled } = makeStore();
    seed(store);
    store.enqueue(ev(1, { type: "block_start", index: 0, block: "text" }));
    store.enqueue(ev(2, { type: "text_delta", index: 0, text: "local text that is longer" }));
    expect(scheduled).toHaveLength(1);
    store.enqueue(
      ev(null, {
        type: "snapshot",
        status: "interrupted",
        message: {
          id: "a1",
          chatId: "c1",
          role: "assistant",
          content: [{ type: "text", text: "local text", citations: null }],
          status: "interrupted",
          requestedModel: "claude-sonnet-5-5",
          servingModel: "claude-sonnet-5-5",
          stopReason: null,
          refusal: null,
          error: null,
          timings: null,
          generationId: "g1",
        },
      }),
    );
    const m = store.getMessage("a1")!;
    expect(m.status).toBe("interrupted");
    // Interrupted snapshot keeps the longer local text (D2).
    expect(textOf(m.blocks)).toBe("local text that is longer");
    expect(m.lastSeq).toBe(2);
  });

  it("a done snapshot replaces local state even when local seq is ahead of zero", () => {
    const { store, runFrame } = makeStore();
    seed(store);
    store.enqueue(ev(1, { type: "block_start", index: 0, block: "text" }));
    store.enqueue(ev(2, { type: "text_delta", index: 0, text: "partial" }));
    runFrame();
    store.enqueue(
      ev(null, {
        type: "snapshot",
        status: "done",
        message: {
          id: "a1",
          chatId: "c1",
          role: "assistant",
          content: [{ type: "text", text: "the complete server text", citations: null }],
          status: "done",
          requestedModel: "claude-sonnet-5-5",
          servingModel: "claude-opus-4-8",
          stopReason: "end_turn",
          refusal: null,
          error: null,
          timings: { server: { received: 1 } },
          generationId: "g1",
        },
      }),
    );
    const m = store.getMessage("a1")!;
    expect(m.status).toBe("done");
    expect(textOf(m.blocks)).toBe("the complete server text");
    expect(m.servingModel).toBe("claude-opus-4-8");
    expect(m.connection).toBe("idle");
  });

  it("builds thinking, dividers, refusal and terminal states", () => {
    const { store, runFrame } = makeStore();
    seed(store);
    store.enqueue(ev(1, { type: "block_start", index: 0, block: "thinking" }));
    store.enqueue(ev(2, { type: "thinking_delta", index: 0, text: "hmm" }));
    store.enqueue(ev(3, { type: "block_stop", index: 0 }));
    store.enqueue(ev(4, { type: "block_start", index: 1, block: "text" }));
    store.enqueue(ev(5, { type: "text_delta", index: 1, text: "before" }));
    store.enqueue(ev(6, { type: "fallback_boundary", index: 2, from: "claude-sonnet-5-5", to: "claude-opus-4-8", category: "cyber", visible: true }));
    store.enqueue(ev(7, { type: "block_start", index: 3, block: "text" }));
    store.enqueue(ev(8, { type: "text_delta", index: 3, text: " after" }));
    store.enqueue(ev(9, { type: "refusal", category: null, explanation: null, hadText: true }));
    store.enqueue(ev(10, { type: "done", stopReason: "refusal", servingModel: "claude-opus-4-8", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0, estimated: false }, timings: { received: 0 } }));
    runFrame();
    const m = store.getMessage("a1")!;
    expect(m.blocks.map((b) => b.type)).toEqual(["thinking", "text", "divider", "text"]);
    expect(m.thinkingStartedAt).toBe(1000);
    expect(m.thinkingEndedAt).toBe(1000);
    expect(m.status).toBe("refused");
    expect(m.discardedText).toBe(true);
    expect(m.servingModel).toBe("claude-opus-4-8");
  });

  it("hydrate keeps an in-flight message and truncateFrom removes the tail", () => {
    const { store } = makeStore();
    seed(store);
    store.hydrateChat("c1", "Title", [
      createMessageState({ id: "u1", chatId: "c1", role: "user", blocks: [{ type: "text", text: "q" }] }),
      createMessageState({ id: "a1", chatId: "c1", role: "assistant", status: "done" }),
    ]);
    expect(store.getChat("c1").messageIds).toEqual(["u1", "a1"]);
    expect(store.getMessage("a1")!.status).toBe("streaming");
    store.truncateFrom("a1");
    expect(store.getChat("c1").messageIds).toEqual(["u1"]);
    expect(store.getMessage("a1")).toBeUndefined();
  });

  it("records client timings once", () => {
    const { store } = makeStore();
    seed(store);
    store.markClientTiming("a1", "firstByte", 5);
    store.markClientTiming("a1", "firstByte", 9);
    expect(store.getMessage("a1")!.timings?.client?.firstByte).toBe(5);
  });
});
