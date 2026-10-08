import { afterEach, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "./ratelimit";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("RateLimiter sweeping", () => {
  it("drops a key once its whole day window has passed, keeps one with a recent hit", () => {
    let now = 0;
    const limiter = new RateLimiter(20, 300, () => now);
    limiter.check("old");
    now = 12 * 3_600_000;
    limiter.check("recent");
    now = 86_400_000 + 1;
    limiter.sweep();
    // `old` starts afresh with a full day; `recent` still counts its one hit.
    expect(limiter.check("old", false).remainingDay).toBe(300);
    expect(limiter.check("recent", false).remainingDay).toBe(299);
    expect((limiter as unknown as { hits: Map<string, number[]> }).hits.has("old")).toBe(false);
  });

  it("runs one timer however often startSweeper is called, and sweeps on it", () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(globalThis, "setInterval");
    let now = 0;
    const limiter = new RateLimiter(20, 300, () => now);
    limiter.check("u");
    for (let i = 0; i < 5; i++) limiter.startSweeper();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    now = 86_400_000 + 1;
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect((limiter as unknown as { hits: Map<string, number[]> }).hits.size).toBe(0);
    limiter.stopSweeper();
    expect(vi.getTimerCount()).toBe(0);
  });
});
