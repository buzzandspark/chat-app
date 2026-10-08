import { describe, expect, it } from "vitest";
import { MAX_AUTO_RETRIES, rateLimitDelayMs } from "./rate-limit";

describe("rateLimitDelayMs", () => {
  it("doubles the server's retry-after per attempt and caps at two minutes", () => {
    expect(rateLimitDelayMs(0, 20_000)).toBe(20_000);
    expect(rateLimitDelayMs(1, 20_000)).toBe(40_000);
    expect(rateLimitDelayMs(2, 20_000)).toBe(80_000);
    expect(rateLimitDelayMs(3, 20_000)).toBe(120_000);
  });
  it("uses 15 s without a retry-after and never waits under 2 s", () => {
    expect(rateLimitDelayMs(0, undefined)).toBe(15_000);
    expect(rateLimitDelayMs(0, 500)).toBe(2_000);
    expect(rateLimitDelayMs(2, 500)).toBe(8_000);
  });
  it("allows four automatic tries", () => {
    expect(MAX_AUTO_RETRIES).toBe(4);
  });
});
