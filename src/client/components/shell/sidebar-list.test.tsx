import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "../ui/modal-manager";
import { SidebarList } from "./sidebar-list";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, className, children }: { href: string; className?: string; children: ReactNode }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@client/store/context", () => ({ useChatStore: () => ({}) }));
vi.mock("@client/store/prefetch", () => ({ prefetchChat: async () => {} }));

const chats = [{ id: "11111111-1111-4111-8111-111111111111", title: "Trip plans", updatedAt: 2 }];
const groups = [{ id: "g1", name: "Work", position: 0, collapsed: false }];

const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });

function renderList() {
  render(
    <ModalProvider>
      <SidebarList initialChats={chats} initialGroups={groups} />
    </ModalProvider>,
  );
}

/** Opens a ⋯ from the keyboard (the stand-in's click arms the real trigger, which mounts open), then Escape. */
async function openAndEscape(name: string) {
  act(() => screen.getByRole("button", { name }).focus());
  fireEvent.click(document.activeElement!);
  await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole("menu").contains(document.activeElement)).toBe(true));
  press("Escape");
  await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
}

describe("SidebarList ⋯ menus", () => {
  beforeEach(() => {
    // Radix's popper measures its trigger; jsdom lacks the observer it uses.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Escape returns focus to the chat row's ⋯, which is the stand-in again", async () => {
    renderList();
    await openAndEscape("Actions for Trip plans");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions for Trip plans" })));
    // Disarmed: the Radix trigger (aria-haspopup) has given way to the plain stand-in.
    expect(document.activeElement).not.toHaveAttribute("aria-haspopup");
  });

  it("Escape returns focus to the group's ⋯", async () => {
    renderList();
    await openAndEscape("Actions for group Work");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions for group Work" })));
    expect(document.activeElement).not.toHaveAttribute("aria-haspopup");
  });

  it("after a right-click on the row, Escape puts focus on the row's ⋯", async () => {
    renderList();
    fireEvent.contextMenu(screen.getByRole("link", { name: "Trip plans" }));
    await waitFor(() => expect(screen.getByRole("menu").contains(document.activeElement)).toBe(true));
    press("Escape");
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Actions for Trip plans" })));
  });

  it("closed by a right-click elsewhere, the menu leaves focus alone", async () => {
    renderList();
    act(() => screen.getByRole("button", { name: "Actions for Trip plans" }).focus());
    fireEvent.click(document.activeElement!);
    await waitFor(() => expect(screen.getByRole("menu").contains(document.activeElement)).toBe(true));
    // A modal menu's outside left click still returns focus to the trigger (Radix); a right-click doesn't.
    fireEvent.pointerDown(screen.getByText("Work"), { button: 2 });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    // Disarmed (the stand-in is back) without pulling focus to it.
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Trip plans" })).not.toHaveAttribute("aria-haspopup"));
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Actions for Trip plans" }));
  });
});
