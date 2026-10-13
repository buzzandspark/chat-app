import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessageState } from "@client/store/chat-store";
import { CACHE_WARM_MS } from "@shared/forks";
import { ExploreOptions, optionsFound } from "./explore-options";

const dimmed = (b: HTMLElement) => b.querySelector('[data-part="label"]')!.classList.contains("opacity-60");
const marching = (b: HTMLElement) => b.querySelector('[data-part="border"]')!.classList.contains("explore-border");
const pulsing = (b: HTMLElement) => b.querySelector('[data-part="label"]')!.classList.contains("animate-pulse");

function setup(props: Partial<Parameters<typeof ExploreOptions>[0]> = {}) {
  const onOpen = vi.fn();
  render(<ExploreOptions shown count={3} requestedAt={1_000_000} now={1_000_000 + 1000} state="ready" onOpen={onOpen} {...props} />);
  return { onOpen, button: screen.getByTestId("explore-options") };
}

afterEach(cleanup);

describe("ExploreOptions", () => {
  it("ready: up, lit and clickable, by pointer or keyboard, with no tooltip", () => {
    const { onOpen, button } = setup();
    expect(button).toHaveTextContent("Explore 3 options");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("data-tip");
    expect(button.parentElement).toHaveAttribute("data-explore", "shown");
    expect(button.parentElement).not.toHaveAttribute("inert");
    expect(button).not.toHaveClass("invisible");
    expect(pulsing(button)).toBe(false);
    expect(marching(button)).toBe(false);
    fireEvent.click(button);
    fireEvent.click(button, { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("not shown: tucked behind the border, inert, keeps its label, and ignores clicks", () => {
    const { onOpen, button } = setup({ shown: false, count: 2 });
    expect(button.parentElement).toHaveAttribute("data-explore", "hidden");
    expect(button.parentElement).toHaveAttribute("inert");
    expect(button).toHaveClass("invisible");
    expect(button).toHaveTextContent("Explore 2 options");
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("clicked before the options finished: pulses, lit, and ignores more clicks", () => {
    const { onOpen, button } = setup({ state: "awaiting" });
    expect(pulsing(button)).toBe(true);
    expect(dimmed(button)).toBe(false);
    expect(marching(button)).toBe(true);
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores clicks while forking", () => {
    const { onOpen, button } = setup({ state: "busy" });
    expect(button).toHaveTextContent("Forking…");
    expect(dimmed(button)).toBe(true);
    expect(marching(button)).toBe(true);
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("past the cache window a ready button carries the cache-expired tooltip", () => {
    const fresh = setup();
    expect(fresh.button).not.toHaveAttribute("data-tip");
    cleanup();
    const stale = setup({ now: 1_000_000 + CACHE_WARM_MS + 1 });
    expect(stale.button).toHaveAttribute("data-tip", expect.stringContaining("start slower"));
  });
});

describe("optionsFound", () => {
  const ok = { isFork: false, forks: 0, editing: false };
  const reply = (patch: Parameters<typeof createMessageState>[0] extends infer P ? Partial<P> : never = {}) =>
    createMessageState({ id: "m", chatId: "c", role: "assistant", status: "done", options: [{ title: "A", prompt: "a" }, { title: "B", prompt: "b" }], ...patch });

  it("is false whenever the chat or the reply can't be explored", () => {
    expect(optionsFound(reply(), { ...ok, isFork: true })).toBe(false);
    expect(optionsFound(reply(), { ...ok, forks: 1 })).toBe(false);
    expect(optionsFound(reply(), { ...ok, editing: true })).toBe(false);
    expect(optionsFound(undefined, ok)).toBe(false);
    expect(optionsFound(createMessageState({ id: "u", chatId: "c", role: "user" }), ok)).toBe(false);
    expect(optionsFound(reply({ status: "streaming" }), ok)).toBe(false);
    expect(optionsFound(reply({ status: "stopped" }), ok)).toBe(false);
    expect(optionsFound(reply({ options: [] }), ok)).toBe(false);
    expect(optionsFound(reply({ options: null }), ok)).toBe(false);
    expect(optionsFound(reply({ options: null, optionsStream: { count: 1, partial: [], failed: false } }), ok)).toBe(false);
  });

  it("is false while the count is still coming, true once it says two or more", () => {
    expect(optionsFound(reply({ options: null, optionsStream: { count: null, partial: [], failed: false } }), ok)).toBe(false);
    expect(optionsFound(reply({ options: null, optionsStream: { count: 3, partial: [], failed: false } }), ok)).toBe(true);
    expect(optionsFound(reply(), ok)).toBe(true);
  });
});
