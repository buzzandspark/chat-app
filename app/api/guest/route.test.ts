// @vitest-environment node
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@db/client";
import { users } from "@db/schema";
import { createTestDb, seedUser } from "@relay/test-utils";
import { getLimiters } from "@server/ratelimit";
import { proxy } from "@/proxy";
import { GET, POST } from "./route";

vi.mock("server-only", () => ({}));
const ctx = vi.hoisted(() => ({ db: null as Db | null, headers: new Headers() }));
vi.mock("@db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@db/client")>()),
  getDb: () => ctx.db,
}));
vi.mock("next/headers", () => ({ headers: async () => ctx.headers }));
const api = vi.hoisted(() => ({
  getSession: vi.fn<() => Promise<{ user: { banned?: boolean } } | null>>(async () => null),
  signInAnonymous: vi.fn(async () => ({
    headers: new Headers([["set-cookie", "better-auth.session_token=t; Path=/; HttpOnly"]]),
    response: { user: { id: "guest-1" } },
  })),
}));
vi.mock("@auth/server", () => ({ getAuth: () => ({ api }) }));

const PAGE = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none" };
let nextIp = 0;

function request(method: "GET" | "POST", query: string, headers: Record<string, string> = {}): Request {
  const req = new Request(`http://localhost/api/guest${query}`, { method, headers: { "x-real-ip": `10.0.0.${nextIp}`, ...headers } });
  ctx.headers = req.headers;
  return req;
}
const get = (headers: Record<string, string>, query = "?next=/c/abc") => GET(request("GET", query, headers));

const g = globalThis as unknown as { __chatLimiters?: ReturnType<typeof getLimiters> };

beforeEach(() => {
  ctx.db = createTestDb();
  nextIp++;
  vi.stubEnv("TRUSTED_IP_HEADER", "x-real-ip");
  api.getSession.mockClear().mockResolvedValue(null);
  api.signInAnonymous.mockClear();
});
afterEach(() => {
  for (const limiter of Object.values(g.__chatLimiters ?? {})) limiter.stopSweeper();
  delete g.__chatLimiters;
  vi.unstubAllEnvs();
});

describe("GET /api/guest", () => {
  it("makes a page visit a guest and sends it back with the cookie", async () => {
    const res = await get(PAGE);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/c/abc");
    expect(res.headers.get("set-cookie")).toContain("better-auth.session_token=t");
    expect(api.signInAnonymous).toHaveBeenCalledOnce();
  });

  it("charges the new guest's spend to the address it came from", async () => {
    seedUser(ctx.db!, "guest-1", { role: "guest", isAnonymous: true });
    await get(PAGE);
    expect(ctx.db!.select({ keys: users.budgetKeys }).from(users).where(eq(users.id, "guest-1")).get()?.keys).toEqual([`ip:10.0.0.${nextIp}`]);
  });

  it("sends anything but a page visit to sign in, creating nothing", async () => {
    const notPageVisits: Record<string, string>[] = [
      {},
      { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "image", "sec-fetch-site": "cross-site" },
      { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty", "sec-fetch-site": "same-origin", rsc: "1", "next-router-prefetch": "1" },
      { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe", "sec-fetch-site": "cross-site" },
      { "user-agent": "Slackbot-LinkExpanding 1.0" },
    ];
    for (const headers of notPageVisits) {
      const res = await get(headers);
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toBe("/login?next=%2Fc%2Fabc");
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(api.signInAnonymous).not.toHaveBeenCalled();
  });

  it("refuses a prefetch or prerender, which the browser then discards, creating nothing", async () => {
    for (const purpose of ["prefetch", "prefetch;prerender", "prefetch;anonymous-client-ip"]) {
      const res = await get({ ...PAGE, "sec-purpose": purpose });
      expect(res.status).toBe(503);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("set-cookie")).toBeNull();
    }
    expect(api.signInAnonymous).not.toHaveBeenCalled();
  });

  it("reuses a live session whatever kind of request it is", async () => {
    api.getSession.mockResolvedValue({ user: {} });
    const res = await get({});
    expect(res.headers.get("location")).toBe("/c/abc");
    expect(api.signInAnonymous).not.toHaveBeenCalled();
  });

  it("never redirects off the site", async () => {
    for (const next of ["/.//evil.com", "//evil.com", "/%5Cevil.com", "https://evil.com"]) {
      const location = (await get(PAGE, `?next=${encodeURIComponent(next)}`)).headers.get("location") ?? "";
      expect(location.startsWith("/") && !location.startsWith("//")).toBe(true);
    }
  });

  it("allows 10 new guests a minute per address, then sends that address to sign in", async () => {
    for (let i = 0; i < 10; i++) expect((await get(PAGE)).headers.get("location")).toBe("/c/abc");
    expect((await get(PAGE)).headers.get("location")).toMatch(/^\/login/);
    nextIp++;
    expect((await get(PAGE)).headers.get("location")).toBe("/c/abc");
  });

  it("allows 60 new guests a minute across every address, and a refusal there costs the address nothing", async () => {
    for (let i = 0; i < 60; i++) {
      if (i % 10 === 0) nextIp++;
      expect((await get(PAGE)).headers.get("location")).toBe("/c/abc");
    }
    nextIp++;
    expect((await get(PAGE)).headers.get("location")).toMatch(/^\/login/);
    getLimiters().guestStartAll.reset();
    for (let i = 0; i < 10; i++) expect((await get(PAGE)).headers.get("location")).toBe("/c/abc");
  });
});

describe("POST /api/guest", () => {
  it("makes a guest from the login page's form", async () => {
    const res = await POST(request("POST", "?next=/c", { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/c");
    expect(res.headers.get("set-cookie")).toContain("better-auth.session_token=t");
  });

  it("is refused cross-site by the proxy", async () => {
    const res = proxy(new NextRequest("http://localhost/api/guest?next=/c", { method: "POST", headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" } }));
    expect(res.status).toBe(403);
  });
});
