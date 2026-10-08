import { afterEach, describe, expect, it, vi } from "vitest";
import { patchChatOptimistic, SidebarStore, type ChatSummary } from "./sidebar-store";

function makeStore(chats: ChatSummary[] = []) {
  const store = new SidebarStore();
  store.hydrate(chats);
  let emits = 0;
  store.subscribe(() => emits++);
  return { store, emits: () => emits };
}

const ids = (store: SidebarStore) => store.get().map((c) => c.id);

describe("SidebarStore.upsert", () => {
  it("keeps pinned when a send names only id, title and updatedAt", () => {
    const { store } = makeStore([
      { id: "a", title: "A", updatedAt: 300 },
      { id: "p", title: "Pinned", updatedAt: 200, pinned: true },
    ]);
    store.upsert({ id: "p", title: "Pinned, renamed", updatedAt: 400 });
    expect(store.get()).toEqual([
      { id: "p", title: "Pinned, renamed", updatedAt: 400, pinned: true },
      { id: "a", title: "A", updatedAt: 300 },
    ]);
  });

  it("inserts a chat it does not know yet, sorted by updatedAt", () => {
    const { store, emits } = makeStore([
      { id: "a", title: "A", updatedAt: 300 },
      { id: "b", title: "B", updatedAt: 100 },
    ]);
    store.upsert({ id: "new", title: "New", updatedAt: 200 });
    expect(ids(store)).toEqual(["a", "new", "b"]);
    expect(store.get()[1]).toEqual({ id: "new", title: "New", updatedAt: 200 });
    expect(emits()).toBe(1);
  });
});

describe("SidebarStore.patch and remove", () => {
  it("patch merges fields and re-sorts only on updatedAt; remove drops the row", () => {
    const { store } = makeStore([
      { id: "a", title: "A", updatedAt: 300 },
      { id: "b", title: "B", updatedAt: 200 },
    ]);
    store.patch("b", { pinned: true });
    expect(ids(store)).toEqual(["a", "b"]);
    expect(store.get()[1]).toEqual({ id: "b", title: "B", updatedAt: 200, pinned: true });
    store.patch("b", { pinned: false });
    expect(store.get()[1]?.pinned).toBe(false);
    store.remove("a");
    expect(ids(store)).toEqual(["b"]);
  });
});

describe("patchChatOptimistic", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const chats = (): ChatSummary[] => [
    { id: "a", title: "A", updatedAt: 300 },
    { id: "b", title: "B", updatedAt: 200 },
  ];

  it("keeps the pin when the server takes it, and sends it as a PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { store } = makeStore(chats());
    await expect(patchChatOptimistic(store, "a", { pinned: true })).resolves.toBe(true);
    expect(store.get()[0]?.pinned).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/chats/a", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ pinned: true }) }));
  });

  it("rolls the pin back when the request never reaches the server, without an unhandled rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const { store } = makeStore(chats());
    const pending = patchChatOptimistic(store, "a", { pinned: true });
    expect(store.get()[0]?.pinned).toBe(true);
    await expect(pending).resolves.toBe(false);
    expect(store.get()[0]?.pinned).toBe(false);
  });

  it("rolls an unpin back when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const { store } = makeStore([{ id: "p", title: "P", updatedAt: 100, pinned: true }, ...chats()]);
    await expect(patchChatOptimistic(store, "p", { pinned: false })).resolves.toBe(false);
    expect(store.get().find((c) => c.id === "p")?.pinned).toBe(true);
  });

  it("a late failure leaves alone a newer change the server did take", async () => {
    let failFirst!: () => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise((_, reject) => (failFirst = () => reject(new TypeError("Failed to fetch")))))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { store } = makeStore(chats());
    // Pin (fails late), then unpin (taken): the late failure must not restore the pre-pin state over it.
    const first = patchChatOptimistic(store, "a", { pinned: true });
    await patchChatOptimistic(store, "a", { pinned: false });
    failFirst();
    await first;
    expect(store.get()[0]?.pinned).toBe(false);
  });
});
