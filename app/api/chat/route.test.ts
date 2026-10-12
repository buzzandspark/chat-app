// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@server/relay", () => ({ getRelay: vi.fn(() => ({ engine: { owner: () => null, start: () => ({ created: true }), resume: () => ({ kind: "gone" }) }, store: { has: () => false } })) }));

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
