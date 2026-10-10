import { afterEach, describe, expect, it, vi } from "vitest";
import type { OptionsTrace } from "@shared/forks";
import { logOptionsTrace, rewriteOptions, traceTimings } from "./forks";

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
