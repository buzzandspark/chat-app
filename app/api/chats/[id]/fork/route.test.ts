// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createForks, ForkStartError } from "@relay/forks";
import { BudgetExceededError, PromptTooLongError } from "@relay/quota";
import { requireUser } from "@server/current-user";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
vi.mock("@db/client", () => ({ getDb: () => null }));
vi.mock("@server/relay", () => ({ getRelay: () => ({ engine: null, store: null }) }));
vi.mock("@relay/forks", async (importOriginal) => ({ ...(await importOriginal<typeof import("@relay/forks")>()), createForks: vi.fn() }));
vi.mock("@server/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/current-user")>()),
  requireUser: vi.fn(),
}));

const STARTED = { chatId: crypto.randomUUID(), generationId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID() };

function fork(): Promise<Response> {
  const forks = [1, 2].map((i) => ({ title: `Option ${i}`, prompt: `Explore ${i}`, chatId: crypto.randomUUID(), generationId: crypto.randomUUID(), userMessageId: crypto.randomUUID(), assistantMessageId: crypto.randomUUID() }));
  const request = new NextRequest("http://localhost/api/chats/p1/fork", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ forks }) });
  return POST(request, { params: Promise.resolve({ id: "p1" }) });
}

beforeEach(() => {
  vi.mocked(requireUser).mockResolvedValue({ id: "g1", role: "guest", email: "g1@guest.invalid", name: "Guest" });
});

describe("POST /api/chats/[id]/fork refused by a guest limit", () => {
  it("answers spent budgets with 429 and the wait, and an oversized prompt with 413", async () => {
    vi.mocked(createForks).mockImplementationOnce(() => {
      throw new ForkStartError(new BudgetExceededError(30_000), []);
    });
    const busy = await fork();
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("30");
    expect(await busy.json()).toEqual({ error: "rate_limited", retryAfterMs: 30_000 });

    vi.mocked(createForks).mockImplementationOnce(() => {
      throw new ForkStartError(new PromptTooLongError(70_000, 60_000), []);
    });
    const long = await fork();
    expect(long.status).toBe(413);
    expect(await long.json()).toEqual({ error: "context_full" });
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
