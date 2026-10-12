import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { clientIp, clientKeys, getLimiters, refuseGuestRewrite, refuseGuestSend } from "./ratelimit";

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
  beforeEach(() => vi.stubEnv("TRUSTED_IP_HEADER", undefined));
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

describe("clientKeys", () => {
  beforeEach(() => vi.stubEnv("TRUST_PROXY_HOPS", "1"));
  afterEach(() => vi.unstubAllEnvs());
  const keys = (headers: Record<string, string>) => clientKeys(new Request("http://x/", { headers }));

  it("reads the single address in TRUSTED_IP_HEADER and ignores X-Forwarded-For", () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "X-Real-IP");
    expect(keys({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "6.6.6.6" })).toEqual({ ip: "1.2.3.4", budgetKeys: ["ip:1.2.3.4"] });
  });

  it("fails closed to one shared key when the trusted header is missing, a list or not an address", () => {
    vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
    const unknown = { ip: "unknown", budgetKeys: ["ip:unknown"] };
    expect(keys({ "x-forwarded-for": "1.2.3.4" })).toEqual(unknown);
    for (const value of ["1.2.3.4, 5.6.7.8", "local", "", "1.2.3.4:80", "999.1.1.1", "2001:db8::g"]) expect(keys({ "x-real-ip": value })).toEqual(unknown);
  });

  it("falls back to TRUST_PROXY_HOPS, and fails closed with fewer entries than proxies", () => {
    vi.stubEnv("TRUST_PROXY_HOPS", "2");
    expect(keys({ "x-forwarded-for": "6.6.6.6, 1.2.3.4, 10.0.0.1" }).ip).toBe("1.2.3.4");
    expect(keys({ "x-forwarded-for": "1.2.3.4" }).ip).toBe("unknown");
    expect(keys({}).ip).toBe("unknown");
  });

  it("keys IPv6 by its /64 and /48, however the address is written", () => {
    const expected = { ip: "2001:db8:aa:bb::/64", budgetKeys: ["ip:2001:db8:aa:bb::/64", "ip48:2001:db8:aa::/48"] };
    for (const value of ["2001:db8:aa:bb:1:2:3:4", "2001:DB8:AA:BB::1", "2001:0db8:00aa:00bb::", "[2001:db8:aa:bb::5]", "[2001:db8:aa:bb::5]:443", "2001:db8:aa:bb::5%eth0"]) {
      expect(keys({ "x-forwarded-for": value })).toEqual(expected);
    }
  });

  it("expands `::` before taking the prefix", () => {
    expect(keys({ "x-forwarded-for": "2001:db8::1" }).budgetKeys).toEqual(["ip:2001:db8:0:0::/64", "ip48:2001:db8:0::/48"]);
    expect(keys({ "x-forwarded-for": "::1" }).ip).toBe("0:0:0:0::/64");
  });

  it("puts two /64s under one /48 in the same ip48 bucket", () => {
    const a = keys({ "x-forwarded-for": "2001:db8:aa:1::1" }).budgetKeys;
    const b = keys({ "x-forwarded-for": "2001:db8:aa:2::1" }).budgetKeys;
    expect(a[0]).not.toBe(b[0]);
    expect(a[1]).toBe(b[1]);
  });

  it("maps an IPv4-mapped IPv6 address to plain IPv4", () => {
    for (const value of ["::ffff:1.2.3.4", "::FFFF:1.2.3.4", "::ffff:102:304", "0:0:0:0:0:ffff:1.2.3.4", "[::ffff:1.2.3.4]:8080"]) {
      expect(keys({ "x-forwarded-for": value })).toEqual({ ip: "1.2.3.4", budgetKeys: ["ip:1.2.3.4"] });
    }
  });
});

describe("refuseGuestSend and refuseGuestRewrite", () => {
  beforeEach(() => {
    delete g.__chatLimiters;
    vi.stubEnv("TRUST_PROXY_HOPS", "1");
  });
  afterEach(() => {
    for (const limiter of Object.values(g.__chatLimiters ?? {})) limiter.stopSweeper();
    delete g.__chatLimiters;
    vi.unstubAllEnvs();
  });
  const from = (ip: string) => new Request("http://x/", { headers: { "x-forwarded-for": ip } });

  it("allows a guest 12 sends a minute and an address 40, counting a send only when both allow it", () => {
    for (let i = 0; i < 12; i++) expect(refuseGuestSend(from("1.1.1.1"), "g1")).toBeNull();
    const refused = refuseGuestSend(from("1.1.1.1"), "g1");
    expect(refused?.status).toBe(429);
    expect(Number(refused?.headers.get("retry-after"))).toBeGreaterThan(0);
    for (let i = 0; i < 28; i++) expect(refuseGuestSend(from("1.1.1.1"), `g${2 + (i % 4)}`)).toBeNull();
    expect(refuseGuestSend(from("1.1.1.1"), "g6")?.status).toBe(429);
    for (let i = 0; i < 12; i++) expect(refuseGuestSend(from("2.2.2.2"), "g6")).toBeNull();
  });

  it("allows a guest 10 Explore rewrites a minute and an address 30, apart from its sends", () => {
    for (let i = 0; i < 10; i++) expect(refuseGuestRewrite(from("1.1.1.1"), "g1")).toBeNull();
    expect(refuseGuestRewrite(from("1.1.1.1"), "g1")?.status).toBe(429);
    expect(refuseGuestSend(from("1.1.1.1"), "g1")).toBeNull();
    for (let i = 0; i < 20; i++) expect(refuseGuestRewrite(from("1.1.1.1"), `g${2 + (i % 2)}`)).toBeNull();
    expect(refuseGuestRewrite(from("1.1.1.1"), "g4")?.status).toBe(429);
    expect(refuseGuestRewrite(from("2.2.2.2"), "g4")).toBeNull();
  });
});
