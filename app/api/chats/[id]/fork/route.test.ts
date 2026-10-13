// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BusyError } from "@relay/engine";
import { createForks, ForkError, ForkStartError } from "@relay/forks";
import { BudgetExceededError } from "@relay/quota";
import { requireUser } from "@server/current-user";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@db/client", () => ({ getDb: () => null }));
vi.mock("@server/relay", () => ({ getRelay: () => ({ engine: null, store: null }) }));
vi.mock("@server/instance-settings", () => ({ guestsBlocked: () => false }));
vi.mock("@relay/forks", async (importOriginal) => ({ ...(await importOriginal<typeof import("@relay/forks")>()), createForks: vi.fn() }));
vi.mock("@server/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/current-user")>()),
  requireUser: vi.fn(),
}));

const STARTED = { chatId: crypto.randomUUID(), generationId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID() };

function fork(): Promise<Response> {
  const forks = [1, 2].map((i) => ({ title: `Option ${i}`, prompt: `Explore ${i}`, chatId: crypto.randomUUID(), generationId: crypto.randomUUID(), userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID() }));
  const request = new NextRequest("http://localhost/api/chats/p1/fork", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: crypto.randomUUID(), forks }) });
  return POST(request, { params: Promise.resolve({ id: "p1" }) });
}

beforeEach(() => {
  vi.mocked(requireUser).mockResolvedValue({ id: "g1", role: "guest", email: "g1@guest.invalid", name: "Guest" });
});

describe("POST /api/chats/[id]/fork refused by a guest limit", () => {
  it("answers spent budgets or too many running replies with 429 and the wait", async () => {
    vi.mocked(createForks).mockImplementationOnce(() => {
      throw new ForkStartError(new BudgetExceededError(30_000), []);
    });
    const busy = await fork();
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("30");
    expect(await busy.json()).toEqual({ error: "rate_limited", retryAfterMs: 30_000 });

    vi.mocked(createForks).mockImplementationOnce(() => {
      throw new ForkStartError(new BusyError(), []);
    });
    expect((await fork()).status).toBe(429);
  });

  it("keeps the forks that started and names why the rest did not", async () => {
    vi.mocked(createForks).mockImplementationOnce(() => {
      throw new ForkStartError(new BudgetExceededError(30_000), [STARTED]);
    });
    const res = await fork();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ forks: [STARTED], failed: { error: "rate_limited", retryAfterMs: 30_000 } });
  });
});

describe("POST /api/chats/[id]/fork on a spent reply", () => {
  it("passes the explored reply to createForks and answers its refusal with 409", async () => {
    vi.mocked(createForks).mockImplementationOnce(() => {
      throw new ForkError("spent");
    });
    const res = await fork();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "spent" });
    expect(vi.mocked(createForks).mock.lastCall?.[1].messageId).toEqual(expect.any(String));
  });
});
