import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModelPicker } from "./model-picker";

// jsdom has no matchMedia: answer every query with the desktop or the phone layout.
function layout(desktop: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const press = (key: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key });

describe("ModelPicker", () => {
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

  it("on desktop, opens from the keyboard, arrows to another model and picks it with Enter", async () => {
    layout(true);
    const onChange = vi.fn();
    render(<ModelPicker model="claude-sonnet-5-5" thinking={{ harder: false }} onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Choose model" });
    act(() => trigger.focus());
    press("Enter");

    const sonnet = await screen.findByRole("menuitemradio", { name: /Claude Sonnet 5.5/ });
    expect(sonnet).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(sonnet).toHaveFocus());

    press("ArrowDown");
    const opus = screen.getByRole("menuitemradio", { name: /Claude Opus 5.5/ });
    await waitFor(() => expect(opus).toHaveFocus());
    press("Enter");

    expect(onChange).toHaveBeenCalledWith({ model: "claude-opus-5-5" });
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("on desktop, picking a model hands focus to the input; Escape returns it to the trigger", async () => {
    layout(true);
    const input = document.body.appendChild(document.createElement("textarea"));
    const focusInput = () => input.focus();
    render(<ModelPicker model="claude-sonnet-5-5" thinking={{ harder: false }} onChange={() => {}} onPicked={focusInput} />);
    const trigger = screen.getByRole("button", { name: "Choose model" });
    act(() => trigger.focus());
    press("Enter");
    const opus = await screen.findByRole("menuitemradio", { name: /Claude Opus 5.5/ });
    fireEvent.click(opus);
    await waitFor(() => expect(input).toHaveFocus());

    act(() => trigger.focus());
    press("Enter");
    await screen.findByRole("menu");
    press("Escape");
    await waitFor(() => expect(trigger).toHaveFocus());
    input.remove();
  });

  it("on desktop, the Think harder toggle is a menu item the arrows reach, and Space keeps the menu open", async () => {
    layout(true);
    const onChange = vi.fn();
    render(<ModelPicker model="claude-haiku-5-5" thinking={{ harder: false }} onChange={onChange} />);
    act(() => screen.getByRole("button", { name: "Choose model" }).focus());
    press("ArrowDown");

    const haiku = await screen.findByRole("menuitemradio", { name: /Claude Haiku 5.5/ });
    expect(haiku).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: /Claude Sonnet 5.5/ })).toHaveFocus());
    for (const name of [/Claude Opus 5.5/, /Claude Haiku 5.5/]) {
      press("ArrowDown");
      const row = screen.getByRole("menuitemradio", { name });
      await waitFor(() => expect(row).toHaveFocus());
    }
    press("ArrowDown");
    const toggle = screen.getByRole("menuitemcheckbox", { name: /Think harder/ });
    await waitFor(() => expect(toggle).toHaveFocus());
    expect(toggle).toHaveAttribute("aria-checked", "false");
    press(" ");

    expect(onChange).toHaveBeenCalledWith({ thinking: { harder: true } });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    // No listbox, and the switch only draws the state: nothing interactive nests in the menu items.
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("on phones, the sheet's models are one radio group the arrows move through, with the switch outside it", async () => {
    layout(false);
    const onChange = vi.fn();
    render(<ModelPicker model="claude-sonnet-5-5" thinking={{ harder: false }} onChange={onChange} defaultOpen />);

    const group = await screen.findByRole("radiogroup", { name: "Models" });
    expect(group).not.toContainElement(screen.getByRole("switch", { name: "Think harder" }));
    const radio = (name: RegExp) => screen.getByRole("radio", { name });
    const [sonnet, opus, haiku] = [radio(/Claude Sonnet 5.5/), radio(/Claude Opus 5.5/), radio(/Claude Haiku 5.5/)];
    expect([sonnet, opus, haiku].map((r) => r.tabIndex)).toEqual([0, -1, -1]);
    act(() => sonnet.focus());
    press("ArrowUp");
    expect(haiku).toHaveFocus();
    press("Home");
    expect(sonnet).toHaveFocus();
    fireEvent.click(opus);
    expect(onChange).toHaveBeenCalledWith({ model: "claude-opus-5-5" });
  });
});
