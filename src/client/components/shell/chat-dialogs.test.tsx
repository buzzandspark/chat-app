import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatStoreProvider } from "@client/store/context";
import { getSidebarStore, type ChatSummary } from "@client/store/sidebar-store";
import { DeleteDialog } from "./chat-dialogs";

const push = vi.fn();
const newChat = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, prefetch: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@client/hooks/use-new-chat", () => ({ useNewChat: () => newChat }));

const chats: ChatSummary[] = [
  { id: "p", title: "Databases", updatedAt: 3 },
  { id: "f1", title: "SQLite", updatedAt: 2, forkedFrom: "p", forkOrder: 0 },
  { id: "f2", title: "Postgres", updatedAt: 1, forkedFrom: "p", forkOrder: 1 },
  { id: "solo", title: "Elsewhere", updatedAt: 0 },
];

async function deleteOpen(id: string) {
  getSidebarStore().hydrate(chats.map((c) => ({ ...c })), "u1");
  const chat = getSidebarStore().get().find((c) => c.id === id)!;
  render(
    <ChatStoreProvider>
      <DeleteDialog chat={chat} currentChatId={id} open onOpenChange={() => {}} />
    </ChatStoreProvider>,
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete" })));
}

describe("DeleteDialog on the open chat", () => {
  beforeEach(() => {
    push.mockClear();
    newChat.mockClear();
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("moves to the next tab over, or the one before when it was the last", async () => {
    await deleteOpen("f1");
    expect(push).toHaveBeenCalledWith("/c/f2");
    cleanup();
    push.mockClear();
    await deleteOpen("f2");
    expect(push).toHaveBeenCalledWith("/c/f1");
    expect(newChat).not.toHaveBeenCalled();
  });

  it("opens a new chat when the chat has no tabs", async () => {
    await deleteOpen("solo");
    expect(push).not.toHaveBeenCalled();
    expect(newChat).toHaveBeenCalledTimes(1);
  });
});
