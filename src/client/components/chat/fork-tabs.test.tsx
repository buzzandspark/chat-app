import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatStoreProvider } from "@client/store/context";
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

afterEach(cleanup);

describe("forkTabs", () => {
  it("lists the main chat first and the forks in their stored order, from the parent or any fork", () => {
    const expected = { parentId: "p", tabs: [{ id: "p", title: "Main chat" }, { id: "f1", title: "SQLite" }, { id: "f2", title: "Postgres" }] };
    expect(forkTabs(chats, "p")).toEqual(expected);
    expect(forkTabs(chats, "f2")).toEqual(expected);
    expect(forkTabs(chats, "other")).toBeNull();
  });

  it("moveBefore puts the dragged tab where the target was", () => {
    expect(moveBefore(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveBefore(["a", "b", "c"], "a", "c")).toEqual(["b", "c", "a"]);
    expect(moveBefore(["a", "b", "c"], "x", "c")).toEqual(["a", "b", "c"]);
  });
});

describe("ForkTabs", () => {
  it("marks the open chat and navigates on click", () => {
    getSidebarStore().hydrate(chats);
    render(
      <ChatStoreProvider>
        <ForkTabs chatId="f1" />
      </ChatStoreProvider>,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Main chat", "SQLite", "Postgres"]);
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.click(tabs[2]!);
    expect(push).toHaveBeenCalledWith("/c/f2");
  });
});
