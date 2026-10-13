import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ModalProvider } from "../ui/modal-manager";
import { SidebarList } from "./sidebar-list";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ prefetch: () => {} }),
}));
vi.mock("next/link", () => ({
  default: ({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode; "aria-current"?: "page"; "aria-label"?: string }) => (
    <a href={href} className={className} aria-current={rest["aria-current"]} aria-label={rest["aria-label"]}>
      {children}
    </a>
  ),
}));
vi.mock("@client/store/context", () => ({ useChatStore: () => ({}) }));
vi.mock("@client/store/prefetch", () => ({ prefetchChat: async () => {} }));

const chats = [
  { id: "11111111-1111-4111-8111-111111111111", title: "Trip plans", updatedAt: 2 },
  { id: "22222222-2222-4222-8222-222222222222", title: "Recipes", updatedAt: 1 },
];

const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });

// jsdom has no IntersectionObserver; the list warms its top five rows through one.
class NoIntersections {
  observe() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal("IntersectionObserver", NoIntersections));

function renderList() {
  render(
    <ModalProvider>
      <SidebarList initialChats={chats} userId="u1" />
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
    fireEvent.pointerDown(screen.getByText("Recipes"), { button: 2 });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    // Disarmed (the stand-in is back) without pulling focus to it.
    await waitFor(() => expect(screen.getByRole("button", { name: "Actions for Trip plans" })).not.toHaveAttribute("aria-haspopup"));
    expect(document.activeElement).not.toBe(screen.getByRole("button", { name: "Actions for Trip plans" }));
  });
});


describe("SidebarList forks", () => {
  const parent = "33333333-3333-4333-8333-333333333333";
  const forkA = "44444444-4444-4444-8444-444444444444";
  const forkB = "55555555-5555-4555-8555-555555555555";
  const withForks = [
    ...chats,
    { id: parent, title: "Databases", updatedAt: 5 },
    { id: forkB, title: "Postgres", updatedAt: 4, forkedFrom: parent, forkOrder: 1 },
    { id: forkA, title: "SQLite", updatedAt: 3, forkedFrom: parent, forkOrder: 0 },
  ];
  afterEach(() => {
    cleanup();
    nav.pathname = "/";
    vi.unstubAllGlobals();
  });

  it("marks the parent and hides its forks until it or one of them is open", () => {
    render(
      <ModalProvider>
        <SidebarList initialChats={withForks} userId="u1" />
      </ModalProvider>,
    );
    expect(screen.getByRole("link", { name: "Databases, has forks" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "SQLite" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Postgres" })).toBeNull();
  });

  it("lists the forks nested under the parent, in order, while a fork is open", () => {
    nav.pathname = `/c/${forkB}`;
    render(
      <ModalProvider>
        <SidebarList initialChats={withForks} userId="u1" />
      </ModalProvider>,
    );
    const nested = screen.getByRole("list", { name: "Forks of Databases" });
    const links = Array.from(nested.querySelectorAll("a")).map((a) => a.textContent);
    expect(links).toEqual(["SQLite", "Postgres"]);
    expect(screen.getByRole("link", { name: "Postgres" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Databases, has forks" })).not.toHaveAttribute("aria-current");
  });

  it("offers Declare winner on a fork's ⋯ and Delete forks on the parent's", async () => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    nav.pathname = `/c/${forkB}`;
    render(
      <ModalProvider>
        <SidebarList initialChats={withForks} userId="u1" />
      </ModalProvider>,
    );
    const items = async (name: string) => {
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() => expect(screen.getByRole("menu")).toBeInTheDocument());
      const out = screen.getAllByRole("menuitem").map((m) => m.textContent);
      press("Escape");
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      return out;
    };
    expect(await items("Actions for Postgres")).toEqual(["Pin", "Rename", "Declare winner", "Delete"]);
    expect(await items("Actions for Databases")).toEqual(["Pin", "Rename", "Delete", "Delete forks", "Delete chat and forks"]);
  });
});
