import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStoreProvider } from "@client/store/context";
import { ModalProvider } from "../ui/modal-manager";
import { getSidebarStore, type ChatSummary } from "@client/store/sidebar-store";
import { ForkTabs, forkTabs, moveBefore } from "./fork-tabs";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, prefetch: vi.fn() }) }));

const chats: ChatSummary[] = [
  { id: "p", title: "Databases", updatedAt: 3 },
  { id: "f2", title: "Postgres", updatedAt: 2, forkedFrom: "p", forkOrder: 1 },
  { id: "f1", title: "SQLite", updatedAt: 1, forkedFrom: "p", forkOrder: 0 },
  { id: "other", title: "Elsewhere", updatedAt: 0 },
];

function renderTabs(chatId: string) {
  render(
    <ChatStoreProvider>
      <ModalProvider>
        <ForkTabs chatId={chatId} />
      </ModalProvider>
    </ChatStoreProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("forkTabs", () => {
  it("lists the main chat first and the forks in their stored order, from the parent or any fork", () => {
    const expected = { parentId: "p", tabs: [{ id: "p", title: "Main chat", hidden: false }, { id: "f1", title: "SQLite", hidden: false }, { id: "f2", title: "Postgres", hidden: false }] };
    expect(forkTabs(chats, "p")).toEqual(expected);
    expect(forkTabs(chats, "f2")).toEqual(expected);
    expect(forkTabs(chats, "other")).toBeNull();
    expect(forkTabs([...chats.slice(0, 1), { ...chats[1]!, tabHidden: true }, chats[2]!], "p")!.tabs[2]!.hidden).toBe(true);
  });

  it("moveBefore puts the dragged tab where the target was", () => {
    expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveBefore(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveBefore(["a", "b", "c"], "x", "c")).toEqual(["a", "b", "c"]);
  });
});

describe("ForkTabs", () => {
  it("marks the open chat and navigates on a click, as the pointer sequence delivers it", () => {
    getSidebarStore().hydrate(chats);
    renderTabs("f1");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Main chat", "SQLite", "Postgres"]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    // A fork tab is draggable; a plain press must still be a click, with no pointer capture taken.
    fireEvent.pointerDown(tabs[2]!, { button: 0, pointerType: "mouse", clientX: 10 });
    fireEvent.pointerUp(tabs[2]!, { pointerType: "mouse", clientX: 10 });
    fireEvent.click(tabs[2]!);
    expect(push).toHaveBeenCalledWith("/c/f2");
    fireEvent.click(tabs[0]!);
    expect(push).toHaveBeenLastCalledWith("/c/p");
  });

  it("a closed tab leaves the strip and is told to the server; opening its chat brings it back", () => {
    getSidebarStore().hydrate(chats);
    renderTabs("f1");
    fireEvent.click(screen.getByRole("button", { name: "Close tab Postgres" }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Main chat", "SQLite"]);
    expect(fetch).toHaveBeenCalledWith("/api/chats/f2", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ tabHidden: true }) }));
    cleanup();
    renderTabs("f2");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Main chat", "SQLite", "Postgres"]);
    expect(fetch).toHaveBeenLastCalledWith("/api/chats/f2", expect.objectContaining({ body: JSON.stringify({ tabHidden: false }) }));
  });

  it("closing the open tab moves to the next one; Ctrl+Shift+brackets cycle", () => {
    getSidebarStore().hydrate(chats);
    renderTabs("f1");
    fireEvent.click(screen.getByRole("button", { name: "Close tab SQLite" }));
    expect(push).toHaveBeenCalledWith("/c/f2");
    cleanup();
    getSidebarStore().hydrate(chats);
    renderTabs("f2");
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, code: "BracketRight" });
    expect(push).toHaveBeenLastCalledWith("/c/p");
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, code: "BracketLeft" });
    expect(push).toHaveBeenLastCalledWith("/c/f1");
  });

  it("a right-click opens the tab's menu: Declare winner on a fork, Delete forks on the main chat", async () => {
    getSidebarStore().hydrate(chats);
    renderTabs("f1");
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Postgres" }));
    const menu = await screen.findByRole("menu", { name: "Tab actions for Postgres" });
    expect(Array.from(menu.querySelectorAll("[role=menuitem]")).map((b) => b.textContent)).toEqual(["Declare winner", "Delete chat"]);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Main chat" }));
    const mainMenu = await screen.findByRole("menu", { name: "Tab actions for Main chat" });
    expect(Array.from(mainMenu.querySelectorAll("[role=menuitem]")).map((b) => b.textContent)).toEqual(["Delete forks", "Delete chat"]);
  });
});
