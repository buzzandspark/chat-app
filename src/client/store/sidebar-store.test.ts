import { describe, expect, it } from "vitest";
import { SidebarStore, type ChatSummary } from "./sidebar-store";

function makeStore(chats: ChatSummary[] = []) {
  const store = new SidebarStore();
  store.hydrate(chats);
  let emits = 0;
  store.subscribe(() => emits++);
  return { store, emits: () => emits };
}

const ids = (store: SidebarStore) => store.get().map((c) => c.id);

describe("SidebarStore.upsert", () => {
  it("keeps pinned and groupId when a send names only id, title and updatedAt", () => {
    const { store } = makeStore([
      { id: "a", title: "A", updatedAt: 300 },
      { id: "p", title: "Pinned", updatedAt: 200, pinned: true },
      { id: "g", title: "Grouped", updatedAt: 100, groupId: "grp1" },
    ]);
    store.upsert({ id: "p", title: "Pinned", updatedAt: 400 });
    store.upsert({ id: "g", title: "Grouped, renamed", updatedAt: 500 });
    expect(store.get()).toEqual([
      { id: "g", title: "Grouped, renamed", updatedAt: 500, groupId: "grp1" },
      { id: "p", title: "Pinned", updatedAt: 400, pinned: true },
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
      { id: "b", title: "B", updatedAt: 200, groupId: "grp1" },
    ]);
    store.patch("b", { pinned: true });
    expect(ids(store)).toEqual(["a", "b"]);
    expect(store.get()[1]).toEqual({ id: "b", title: "B", updatedAt: 200, groupId: "grp1", pinned: true });
    store.patch("b", { groupId: null });
    expect(store.get()[1]?.groupId).toBeNull();
    store.remove("a");
    expect(ids(store)).toEqual(["b"]);
  });
});
