import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMessageState } from "@client/store/chat-store";
import { CACHE_WARM_MS, MAX_FORKS } from "@shared/forks";
import { ExploreOptions, unavailableReason } from "./explore-options";

function setup(props: Partial<Parameters<typeof ExploreOptions>[0]> = {}) {
  const onOpen = vi.fn();
  render(<ExploreOptions count={3} remaining={10} requestedAt={1_000_000} now={1_000_000 + 1000} state="ready" onOpen={onOpen} {...props} />);
  return { onOpen, button: screen.getByTestId("explore-options") };
}

afterEach(cleanup);

describe("ExploreOptions", () => {
  it("ready: lit and clickable, by pointer or keyboard, with no tooltip", () => {
    const { onOpen, button } = setup();
    expect(button).toHaveTextContent("Explore 3 options");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(button).not.toHaveAttribute("data-tip");
    expect(button).not.toHaveClass("animate-pulse");
    fireEvent.click(button);
    fireEvent.click(button, { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("disabled: still shown, dull, ignores clicks, and says why on hover", () => {
    const { onOpen, button } = setup({ count: 0, state: "disabled", reason: "No options to explore in the last reply" });
    expect(button).toBeVisible();
    expect(button).toHaveTextContent("Explore options");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    expect(button).toHaveClass("tip", "opacity-50");
    expect(button).not.toHaveClass("animate-pulse");
    expect(button).toHaveAttribute("data-tip", "No options to explore in the last reply");
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("waiting for the count: dull and pulsing, no number, and says it is looking", () => {
    const { onOpen, button } = setup({ count: null, state: "waiting" });
    expect(button).toHaveTextContent("Explore options");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveClass("animate-pulse", "opacity-50");
    expect(button).toHaveAttribute("data-tip", "Looking for options…");
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("clicked before the options finished: pulses, lit, and ignores more clicks", () => {
    const { onOpen, button } = setup({ state: "awaiting" });
    expect(button).toHaveClass("animate-pulse");
    expect(button).not.toHaveClass("opacity-50");
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("counts only what can still be forked, and ignores clicks while forking", () => {
    expect(setup({ count: 3, remaining: 2 }).button).toHaveTextContent("Explore 2 options");
    cleanup();
    const { onOpen, button } = setup({ state: "busy" });
    expect(button).toHaveTextContent("Forking…");
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("past the cache window a ready button carries the cache-expired tooltip", () => {
    const fresh = setup();
    expect(fresh.button).not.toHaveAttribute("data-tip");
    cleanup();
    const stale = setup({ now: 1_000_000 + CACHE_WARM_MS + 1 });
    expect(stale.button).toHaveAttribute("data-tip", expect.stringContaining("Cache expired"));
  });
});

describe("unavailableReason", () => {
  const ok = { isFork: false, remaining: 10, editing: false };
  const reply = (patch: Parameters<typeof createMessageState>[0] extends infer P ? Partial<P> : never = {}) =>
    createMessageState({ id: "m", chatId: "c", role: "assistant", status: "done", options: [{ title: "A", prompt: "a" }, { title: "B", prompt: "b" }], ...patch });

  it("names why the chat or the reply can't be explored, in order", () => {
    expect(unavailableReason(reply(), { ...ok, isFork: true })).toBe("A fork can't be forked again");
    expect(unavailableReason(reply(), { ...ok, remaining: 0 })).toBe(`This chat already has ${MAX_FORKS} forks`);
    expect(unavailableReason(reply(), { ...ok, editing: true })).toBe("Not while editing a message");
    expect(unavailableReason(undefined, ok)).toBe("Available after a reply");
    expect(unavailableReason(createMessageState({ id: "u", chatId: "c", role: "user" }), ok)).toBe("Available after a reply");
    expect(unavailableReason(reply({ status: "streaming" }), ok)).toBe("Available when the reply finishes");
    expect(unavailableReason(reply({ status: "stopped" }), ok)).toBe("Only after a finished reply");
    expect(unavailableReason(reply({ options: [] }), ok)).toBe("No options to explore in the last reply");
    expect(unavailableReason(reply({ options: null }), ok)).toBe("No options to explore in the last reply");
    expect(unavailableReason(reply({ options: null, optionsStream: { count: 1, partial: [], failed: false } }), ok)).toBe("No options to explore in the last reply");
  });

  it("is null when the button can be used, or is still looking", () => {
    expect(unavailableReason(reply(), ok)).toBeNull();
    expect(unavailableReason(reply({ options: null, optionsStream: { count: null, partial: [], failed: false } }), ok)).toBeNull();
    expect(unavailableReason(reply({ options: null, optionsStream: { count: 3, partial: [], failed: false } }), ok)).toBeNull();
  });
});
