import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CACHE_WARM_MS } from "@shared/forks";
import { ExploreOptions } from "./explore-options";

function setup(props: Partial<Parameters<typeof ExploreOptions>[0]> = {}) {
  const onOpen = vi.fn();
  render(<ExploreOptions count={3} remaining={10} requestedAt={1_000_000} now={1_000_000 + 1000} state="ready" onOpen={onOpen} {...props} />);
  return { onOpen, button: screen.getByTestId("explore-options") };
}

afterEach(cleanup);

describe("ExploreOptions", () => {
  it("ready: lit and clickable, by pointer or keyboard", () => {
    const { onOpen, button } = setup();
    expect(button).toHaveTextContent("Explore 3 options");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).not.toHaveClass("animate-pulse");
    fireEvent.click(button);
    fireEvent.click(button, { detail: 0 });
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("waiting for the count: disabled, dull and pulsing, with no number", () => {
    const { onOpen, button } = setup({ count: null, state: "waiting" });
    expect(button).toHaveTextContent("Explore options");
    expect(button).toBeDisabled();
    expect(button).toHaveClass("animate-pulse", "opacity-50");
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

  it("counts only what can still be forked, and is disabled while forking", () => {
    expect(setup({ count: 3, remaining: 2 }).button).toHaveTextContent("Explore 2 options");
    cleanup();
    const { onOpen, button } = setup({ state: "busy" });
    expect(button).toHaveTextContent("Forking…");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("past the cache window the button carries the cache-expired tooltip", () => {
    const fresh = setup();
    expect(fresh.button).not.toHaveAttribute("data-tip");
    cleanup();
    const stale = setup({ now: 1_000_000 + CACHE_WARM_MS + 1 });
    expect(stale.button).toHaveAttribute("data-tip", expect.stringContaining("Cache expired"));
  });
});
