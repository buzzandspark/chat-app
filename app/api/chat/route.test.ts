// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusyError } from "@relay/engine";
import { BudgetExceededError, PromptTooLongError } from "@relay/quota";
import { SCENARIO_NAMES } from "@relay/scenarios";
import { requireUser } from "@server/current-user";
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
const start = vi.hoisted(() => vi.fn(() => ({ created: true })));
vi.mock("@server/relay", () => ({ getRelay: vi.fn(() => ({ engine: { owner: () => null, start, resume: () => ({ kind: "gone" }) }, store: { has: () => false } })) }));

function send(role: UserRole, extra: Record<string, unknown>): Promise<Response> {
  vi.mocked(requireUser).mockResolvedValue({ id: "u1", role, email: "u1@example.com", name: "u1" });
  const body = { chatId: crypto.randomUUID(), generationId: crypto.randomUUID(), messageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID(), text: "hi", model: "claude-haiku-5-5", ...extra };
  return POST(new NextRequest("http://localhost/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  ctx.isProd = true;
  vi.mocked(getRelay).mockClear();
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
  it("answers an oversized prompt with 413 context_full", async () => {
    start.mockImplementationOnce(() => {
      throw new PromptTooLongError(70_000, 60_000);
    });
    const res = await send("guest", {});
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "context_full" });
  });

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
