import { afterEach, describe, expect, it, vi } from "vitest";
import type { OptionsTrace } from "@shared/forks";
import { ChatStore, createMessageState } from "./chat-store";
import { logOptionsTrace, rewriteOptions, streamOptions, traceTimings, watchOptions } from "./forks";

const trace: OptionsTrace = { model: "claude-haiku-5-5", system: "s", user: "u", response: { kind: "list" }, stopReason: "end_turn", inputTokens: 300, outputTokens: 40, apiMs: 1520 };

afterEach(() => vi.restoreAllMocks());

describe("options trace timings", () => {
  it("lists the page's wait, the Haiku call, the server's detection and the held request, whichever are known", () => {
    expect(traceTimings(trace)).toBe("Haiku 1.52 s");
    expect(traceTimings({ ...trace, totalMs: 1600, waitedMs: 1450 }, 1710)).toBe("1.71 s in the page, Haiku 1.52 s, server 1.60 s, request held 1.45 s");
  });

  it("logs one group headed by the timings", () => {
    const group = vi.spyOn(console, "group").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const end = vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    logOptionsTrace("detect", { ...trace, totalMs: 1600 }, 1710);
    expect(group).toHaveBeenCalledWith("[options] detect: 1.71 s in the page, Haiku 1.52 s, server 1.60 s");
    expect(end).toHaveBeenCalledTimes(1);
  });
});

describe("rewriteOptions", () => {
  it("returns the rewritten options and logs the call; failures come back as a message", async () => {
    const group = vi.spyOn(console, "group").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "groupEnd").mockImplementation(() => {});
    const options = [{ title: "A", prompt: "a" }];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ options, trace }) }));
    expect(await rewriteOptions("m1", "shorter", options)).toEqual({ ok: true, options });
    expect(group.mock.calls[0]![0]).toMatch(/^\[options\] rewrite: [\d.]+ s in the page, Haiku 1\.52 s$/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 402 }));
    expect(await rewriteOptions("m1", "shorter", options)).toEqual({ ok: false, error: "You have reached your usage cap." });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await rewriteOptions("m1", "shorter", options)).toEqual({ ok: false, error: "You seem to be offline." });
    vi.unstubAllGlobals();
  });
});


/** A fetch answering with these JSON lines, split mid-line to exercise the reader. */
function linesFetch(events: object[]) {
  const text = events.map((e) => `${JSON.stringify(e)}\n`).join("");
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 11) controller.enqueue(bytes.slice(i, i + 11));
      controller.close();
    },
  });
  return vi.fn().mockResolvedValue({ ok: true, status: 200, body });
}

describe("options stream", () => {
  const two = [{ title: "A", prompt: "a" }, { title: "B", prompt: "b" }];

  it("streamOptions reads one event per line", async () => {
    vi.stubGlobal("fetch", linesFetch([{ count: 2 }, { options: two.slice(0, 1) }, { count: 2, options: two, done: true, trace: null }]));
    const events: unknown[] = [];
    await streamOptions("m1", (e) => events.push(e));
    expect(events).toEqual([{ count: 2 }, { options: two.slice(0, 1) }, { count: 2, options: two, done: true, trace: null }]);
    vi.unstubAllGlobals();
  });

  it("watchOptions moves a reply from pending to its count to its final list", async () => {
    const store = new ChatStore({ schedule: () => 0, cancel: () => {} });
    store.addMessage(createMessageState({ id: "m1", chatId: "c1", role: "assistant" }));
    const seen: unknown[] = [];
    store.subscribeMessage("m1", () => {
      const m = store.getMessage("m1")!;
      seen.push({ options: m.options, stream: m.optionsStream });
    });
    vi.stubGlobal("fetch", linesFetch([{ count: 2 }, { options: two.slice(0, 1) }, { count: 2, options: two, done: true }]));
    await watchOptions(store, "m1");
    expect(seen[0]).toEqual({ options: null, stream: { count: null, partial: [], failed: false } });
    expect(seen).toContainEqual({ options: null, stream: { count: 2, partial: [], failed: false } });
    expect(seen.at(-1)).toEqual({ options: two, stream: null });
    vi.unstubAllGlobals();
  });

  it("a failure before the count means no button; after a count of two or more the button stays, marked failed", async () => {
    const store = new ChatStore({ schedule: () => 0, cancel: () => {} });
    store.addMessage(createMessageState({ id: "m1", chatId: "c1", role: "assistant" }));
    vi.stubGlobal("fetch", linesFetch([{ error: true }]));
    await watchOptions(store, "m1");
    expect(store.getMessage("m1")).toMatchObject({ options: [], optionsStream: null });
    vi.stubGlobal("fetch", linesFetch([{ count: 3 }, { options: two }]));
    await watchOptions(store, "m1");
    expect(store.getMessage("m1")!.optionsStream).toEqual({ count: 3, partial: two, failed: true });
    vi.unstubAllGlobals();
  });

  it("a fork while the list is still arriving spends the options for good", async () => {
    const store = new ChatStore({ schedule: () => 0, cancel: () => {} });
    store.addMessage(createMessageState({ id: "m1", chatId: "c1", role: "assistant" }));
    store.subscribeMessage("m1", () => {
      if (store.getMessage("m1")!.optionsStream?.count === 2) store.updateMessage("m1", { options: [], optionsStream: null });
    });
    vi.stubGlobal("fetch", linesFetch([{ count: 2 }, { options: two.slice(0, 1) }, { count: 2, options: two, done: true }]));
    await watchOptions(store, "m1");
    expect(store.getMessage("m1")).toMatchObject({ options: [], optionsStream: null });
    vi.unstubAllGlobals();
  });
});
