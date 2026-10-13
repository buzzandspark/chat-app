// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BusyError, MissingUserMessageError, type StartOutcome } from "@relay/engine";
import { BudgetExceededError, QuotaExceededError } from "@relay/quota";
import { SCENARIO_NAMES } from "@relay/scenarios";
import { requireUser } from "@server/current-user";
import { getLimiters } from "@server/ratelimit";
import { getRelay } from "@server/relay";
import type { UserRole } from "@shared/types";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
const ctx = vi.hoisted(() => ({ isProd: true }));
vi.mock("@shared/env", async (importOriginal) => {
  const { env } = await importOriginal<typeof import("@shared/env")>();
  return { env: Object.defineProperties({ ...env }, { isProd: { get: () => ctx.isProd }, e2e: { get: () => false } }) };
});
vi.mock("@server/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/current-user")>()),
  requireUser: vi.fn(),
}));
const start = vi.hoisted(() => vi.fn((): StartOutcome => ({ created: true })));
const owner = vi.hoisted(() => vi.fn((): string | null => null));
vi.mock("@server/relay", () => ({ getRelay: vi.fn(() => ({ engine: { owner, start, resume: () => ({ kind: "gone" }) }, store: { has: () => false } })) }));
vi.mock("@server/instance-settings", () => ({ guestsBlocked: () => false }));

function send(role: UserRole, extra: Record<string, unknown>): Promise<Response> {
  vi.mocked(requireUser).mockResolvedValue({ id: "u1", role, email: "u1@example.com", name: "u1" });
  const body = { chatId: crypto.randomUUID(), generationId: crypto.randomUUID(), messageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(), text: "hi", model: "claude-haiku-5-5", ...extra };
  return POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

const g = globalThis as unknown as { __chatLimiters?: ReturnType<typeof getLimiters> };

beforeEach(() => {
  ctx.isProd = true;
  vi.mocked(getRelay).mockClear();
});
afterEach(() => {
  for (const limiter of Object.values(g.__chatLimiters ?? {})) limiter.stopSweeper();
  delete g.__chatLimiters;
});

describe("POST /api/chat with a scenario", () => {
  it("refuses a non-admin's scenario in production rather than running the live model", async () => {
    for (const role of ["user", "guest"] as const) {
      const res = await send(role, { scenario: SCENARIO_NAMES[0] });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    }
    expect(getRelay).not.toHaveBeenCalled();
  });

  it("lets an admin run one in production, and anyone outside production", async () => {
    expect((await send("admin", { scenario: SCENARIO_NAMES[0] })).status).not.toBe(403);
    ctx.isProd = false;
    expect((await send("guest", { scenario: SCENARIO_NAMES[0] })).status).not.toBe(403);
    expect(getRelay).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/chat refused by a guest limit", () => {
  it("answers spent budgets with 429 and how long until they refill", async () => {
    start.mockImplementationOnce(() => {
      throw new BudgetExceededError(90_500);
    });
    const res = await send("guest", {});
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("91");
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfterMs: 90_500 });
  });

  it("answers a guest with as many replies running as it may with 429", async () => {
    start.mockImplementationOnce(() => {
      throw new BusyError();
    });
    const res = await send("guest", {});
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("10");
  });
});

describe("POST /api/chat refused by the spending cap", () => {
  it("says whether the cap is reached or only too close for a full reply", async () => {
    start.mockImplementationOnce(() => {
      throw new QuotaExceededError(5, 5);
    });
    expect(await (await send("user", {})).json()).toEqual({ error: "quota_exceeded", spentUsd: 5, capUsd: 5 });
    start.mockImplementationOnce(() => {
      throw new QuotaExceededError(4.5, 5);
    });
    const short = await send("user", {});
    expect(short.status).toBe(402);
    expect(await short.json()).toEqual({ error: "quota_short", spentUsd: 4.5, capUsd: 5 });
  });
});

describe("POST /api/chat send rate", () => {
  it("refuses a guest's thirteenth new send in a minute and never limits a member", async () => {
    for (let i = 0; i < 12; i++) expect((await send("guest", {})).status).not.toBe(429);
    const refused = await send("guest", {});
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ error: "rate_limited" });
    for (let i = 0; i < 20; i++) expect((await send("user", {})).status).not.toBe(429);
  });
});

describe("POST /api/chat retrying a reply", () => {
  it("answers a retry whose user message is gone with 409 missing_user_message", async () => {
    start.mockImplementationOnce(() => {
      throw new MissingUserMessageError();
    });
    const res = await send("user", { text: undefined });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "missing_user_message" });
  });
});

describe("POST /api/chat for an existing generation", () => {
  it("refuses to attach anyone but the generation's owner", async () => {
    owner.mockReturnValue("someone-else");
    start.mockReturnValueOnce({ created: false, reason: "exists" });
    const res = await send("user", {});
    owner.mockReturnValue(null);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
  });
});

describe("POST /api/chat effort", () => {
  it("passes the chosen effort on, reads a stale tab's harder flag, and defaults to low", async () => {
    const cases: [unknown, string][] = [
      [{ effort: "xhigh" }, "xhigh"],
      [{ harder: true }, "high"],
      [{ harder: false }, "low"],
      [undefined, "low"],
    ];
    for (const [thinking, effort] of cases) {
      expect((await send("user", { thinking })).status).not.toBe(400);
      expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ thinking: { effort } }));
    }
  });
});
