import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatStore } from "./chat-store";
import { forkChat } from "./fork-chat";

afterEach(() => vi.unstubAllGlobals());

describe("forkChat", () => {
  it("sends the explored reply and reuses an unanswered attempt's ids when the same options are sent again", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetch);
    const store = new ChatStore();
    const router = { push: vi.fn() };
    const options = [{ title: "A", prompt: "a" }, { title: "B", prompt: "b" }];
    const sent = (call: number) => JSON.parse(fetch.mock.calls[call]![1].body);

    expect(await forkChat(store, router, "c1", "m1", options)).toEqual({ ok: false, error: "You're offline. Try again when you're connected." });
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: "spent" }), { status: 409 }));
    expect(await forkChat(store, router, "c1", "m1", options)).toEqual({ ok: false, error: "These options were already explored." });
    await forkChat(store, router, "c1", "m1", options.slice(0, 1));

    expect(sent(0).messageId).toBe("m1");
    expect(sent(1)).toEqual(sent(0));
    expect(sent(2).forks[0].chatId).not.toBe(sent(0).forks[0].chatId);
  });
});
