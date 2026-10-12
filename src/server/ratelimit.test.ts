import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clientIp, getLimiters } from "./ratelimit";

const g = globalThis as unknown as { __chatLimiters?: ReturnType<typeof getLimiters> };

describe("getLimiters", () => {
  beforeEach(() => {
    delete g.__chatLimiters;
  });
  afterEach(() => {
    for (const limiter of Object.values(g.__chatLimiters ?? {})) limiter.stopSweeper();
    delete g.__chatLimiters;
    vi.restoreAllMocks();
  });

  it("starts the sweepers once, not on every call", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const first = getLimiters();
    for (let i = 0; i < 20; i++) expect(getLimiters()).toBe(first);
    // One per limiter, all from the first call.
    expect(spy).toHaveBeenCalledTimes(Object.keys(first).length);
  });
});

describe("clientIp", () => {
  afterEach(() => vi.unstubAllEnvs());
  const req = (headers: Record<string, string>) => new Request("http://x/", { headers });

  it("without a trusted proxy, ignores what the client says and shares one key", () => {
    vi.stubEnv("TRUST_PROXY_HOPS", "0");
    expect(clientIp(req({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" }))).toBe("local");
  });

  it("behind one proxy, takes the entry it added, and keys IPv6 by its /64", () => {
    vi.stubEnv("TRUST_PROXY_HOPS", "1");
    expect(clientIp(req({ "x-forwarded-for": "6.6.6.6, 1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": "2001:db8:aa:bb:1:2:3:4" }))).toBe("2001:db8:aa:bb::/64");
    expect(clientIp(req({ "x-forwarded-for": "2001:db8:aa:bb:9:9:9:9" }))).toBe("2001:db8:aa:bb::/64");
  });
});
