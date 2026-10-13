import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { useIsDesktopOrNull } from "@client/hooks/use-media-query";
import { sidebarAria } from "./sidebar-aria";

describe("sidebarAria", () => {
  it("on a phone, the closed overlay is inert and the open one is a modal dialog", () => {
    // desktopOpen stays true on a phone: the phone flag alone decides there.
    expect(sidebarAria(false, false, true)).toEqual({ inert: true });
    expect(sidebarAria(false, true, true)).toEqual({ role: "dialog", "aria-modal": true, tabIndex: -1 });
  });

  it("on a desktop, the dock is a plain landmark open and inert collapsed, whatever the phone flag", () => {
    expect(sidebarAria(true, false, true)).toEqual({});
    expect(sidebarAria(true, true, true)).toEqual({});
    expect(sidebarAria(true, false, false)).toEqual({ inert: true });
  });

  it("sets nothing while the viewport is unknown", () => {
    expect(sidebarAria(null, false, true)).toEqual({});
    expect(sidebarAria(null, false, false)).toEqual({});
  });
});

function Aside({ phoneOpen = false }: { phoneOpen?: boolean }) {
  return <aside aria-label="Chats" {...sidebarAria(useIsDesktopOrNull(), phoneOpen, true)} />;
}

function mockViewport(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("sidebar modality across hydration", () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function hydrate() {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<Aside />);
    document.body.append(container);
    const aside = container.querySelector("aside")!;
    const serverInert = aside.hasAttribute("inert");
    await act(async () => {
      root = hydrateRoot(container, <Aside />);
    });
    return { aside, serverInert };
  }

  it("a desktop's docked sidebar is never inert, in the server HTML or after hydration, with no mismatch", async () => {
    mockViewport(true);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { aside, serverInert } = await hydrate();
    expect(serverInert).toBe(false);
    expect(aside.hasAttribute("inert")).toBe(false);
    expect(aside.hasAttribute("role")).toBe(false);
    expect(error).not.toHaveBeenCalled();
  });

  it("a phone's closed sidebar turns inert once hydrated, with no mismatch", async () => {
    mockViewport(false);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { aside, serverInert } = await hydrate();
    expect(serverInert).toBe(false);
    expect(aside.hasAttribute("inert")).toBe(true);
    expect(error).not.toHaveBeenCalled();
  });
});
