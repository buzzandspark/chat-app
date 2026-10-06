import { describe, expect, it } from "vitest";
import { EventStore } from "./store";
import type { RelayEvent } from "./events";

describe("EventStore", () => {
  it("assigns sequence numbers as array indices and notifies synchronously", () => {
    const store = new EventStore({ now: () => 1000 });
    store.open("g");
    const seen: RelayEvent[] = [];
    store.subscribe("g", -1, (e) => seen.push(e));
    const a = store.append("g", { type: "block_start", index: 0, block: "text" });
    const b = store.append("g", { type: "text_delta", index: 0, text: "x" });
    expect([a.seq, b.seq]).toEqual([0, 1]);
    expect(seen).toHaveLength(2);
  });

  it("replays from `after` then attaches live, and detaches on terminal", () => {
    const store = new EventStore();
    store.open("g");
    store.append("g", { type: "block_start", index: 0, block: "text" });
    store.append("g", { type: "text_delta", index: 0, text: "a" });
    store.append("g", { type: "text_delta", index: 0, text: "b" });
    const seen: number[] = [];
    store.subscribe("g", 0, (e) => seen.push(e.seq!));
    expect(seen).toEqual([1, 2]);
    store.append("g", { type: "stopped", servingModel: null, usage: null });
    expect(seen).toEqual([1, 2, 3]);
    expect(store.get("g")!.terminal).toBe(true);
    expect(store.get("g")!.subscribers.size).toBe(0);
    expect(() => store.append("g", { type: "text_delta", index: 0, text: "late" })).toThrow();
  });

  it("evicts completed generations 10 minutes after the terminal event", () => {
    let now = 0;
    const store = new EventStore({ now: () => now });
    store.open("g");
    store.append("g", { type: "interrupted", reason: "crash" });
    now = 9 * 60 * 1000;
    expect(store.sweep()).toEqual([]);
    now = 10 * 60 * 1000 + 1;
    expect(store.sweep()).toEqual(["g"]);
    expect(store.has("g")).toBe(false);
  });

  it("lists running generations", () => {
    const store = new EventStore();
    store.open("a");
    store.open("b");
    store.append("b", { type: "interrupted", reason: "crash" });
    expect(store.running()).toEqual(["a"]);
  });
});
