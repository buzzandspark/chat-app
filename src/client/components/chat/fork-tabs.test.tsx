import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStoreProvider } from "@client/store/context";
import { ModalProvider, useModals } from "../ui/modal-manager";
import { getSidebarStore, type ChatSummary } from "@client/store/sidebar-store";
import { ForkTabs, forkTabs } from "./fork-tabs";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, prefetch: vi.fn() }) }));

const chats: ChatSummary[] = [
  { id: "p", title: "Databases", updatedAt: 3 },
  { id: "f2", title: "Postgres", updatedAt: 2, forkedFrom: "p", forkOrder: 1 },
  { id: "f1", title: "SQLite", updatedAt: 1, forkedFrom: "p", forkOrder: 0 },
  { id: "other", title: "Elsewhere", updatedAt: 0 },
];

function OpenDialog() {
  const { show } = useModals();
  return (
    <button type="button" onClick={() => show(() => <div role="dialog" aria-label="Delete chat" />)}>
      Open dialog
    </button>
  );
}

function renderTabs(chatId: string) {
  render(
    <ChatStoreProvider>
      <ModalProvider>
        <ForkTabs chatId={chatId} />
        <OpenDialog />
      </ModalProvider>
    </ChatStoreProvider>,
  );
}

beforeEach(() => {
  push.mockClear();
  // jsdom has no scrolling; the strip scrolls the open tab into view.
  Element.prototype.scrollIntoView = vi.fn();
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
});

describe("ForkTabs", () => {
  it("marks the open chat and navigates on a click", () => {
    getSidebarStore().hydrate(chats, "u1");
    renderTabs("f1");
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Main chat", "SQLite", "Postgres"]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tabs[2]!);
    expect(push).toHaveBeenCalledWith("/c/f2");
    fireEvent.click(tabs[0]!);
    expect(push).toHaveBeenLastCalledWith("/c/p");
  });

  it("a closed tab leaves the strip and is told to the server; opening its chat brings it back", () => {
    getSidebarStore().hydrate(chats, "u1");
    renderTabs("f1");
    fireEvent.click(screen.getByRole("button", { name: "Close tab Postgres" }));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Main chat", "SQLite"]);
    expect(fetch).toHaveBeenCalledWith("/api/chats/f2", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ tabHidden: true }) }));
    cleanup();
    renderTabs("f2");
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Main chat", "SQLite", "Postgres"]);
    expect(fetch).toHaveBeenLastCalledWith("/api/chats/f2", expect.objectContaining({ body: JSON.stringify({ tabHidden: false }) }));
  });

  it("a reopen the server refuses is sent once, not retried in a loop", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    getSidebarStore().hydrate(chats.map((c) => (c.id === "f2" ? { ...c, tabHidden: true } : c)), "u1");
    renderTabs("f2");
    for (let i = 0; i < 5; i++) await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Main chat", "SQLite", "Postgres"]);
  });

  it("Ctrl+Shift+brackets leave the tabs alone while a dialog is open", () => {
    getSidebarStore().hydrate(chats, "u1");
    renderTabs("f2");
    fireEvent.click(screen.getByRole("button", { name: "Open dialog" }));
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, code: "BracketRight" });
    expect(push).not.toHaveBeenCalled();
  });

  it("closing the open tab moves to the next one; Ctrl+Shift+brackets cycle", () => {
    getSidebarStore().hydrate(chats, "u1");
    renderTabs("f1");
    fireEvent.click(screen.getByRole("button", { name: "Close tab SQLite" }));
    expect(push).toHaveBeenCalledWith("/c/f2");
    // Still on its chat until the navigation lands: the tab must stay closed rather than reopen itself.
    expect(getSidebarStore().get().find((c) => c.id === "f1")?.tabHidden).toBe(true);
    cleanup();
    getSidebarStore().hydrate(chats, "u1");
    renderTabs("f2");
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, code: "BracketRight" });
    expect(push).toHaveBeenLastCalledWith("/c/p");
    fireEvent.keyDown(window, { ctrlKey: true, shiftKey: true, code: "BracketLeft" });
    expect(push).toHaveBeenLastCalledWith("/c/f1");
  });

  it("a press on the open tab opens its menu, and a second press closes it", async () => {
    getSidebarStore().hydrate(chats, "u1");
    renderTabs("f1");
    const open = screen.getByRole("tab", { name: "SQLite" });
    fireEvent.click(open);
    expect(await screen.findByRole("menu", { name: "Tab actions for SQLite" })).toBeInTheDocument();
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(push).not.toHaveBeenCalled();
    fireEvent.pointerDown(open);
    fireEvent.click(open);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a right-click opens the tab's menu: Declare winner on a fork, Delete forks on the main chat", async () => {
    getSidebarStore().hydrate(chats, "u1");
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
