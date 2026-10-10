import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTypeToFocus } from "./use-type-to-focus";

function Page({ enabled = true }: { enabled?: boolean }) {
  useTypeToFocus(enabled);
  return (
    <div>
      <button type="button">Send</button>
      <input aria-label="Search" />
      <textarea aria-label="Message" defaultValue="draft" />
    </div>
  );
}

afterEach(cleanup);

describe("useTypeToFocus", () => {
  it("a letter typed with nothing editable focused focuses the composer, caret at the end", () => {
    render(<Page />);
    const composer = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
    screen.getByRole("button", { name: "Send" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "h" });
    expect(document.activeElement).toBe(composer);
    expect(composer.selectionStart).toBe("draft".length);
  });

  it("leaves modifiers, spaces, special keys, other fields and a disabled hook alone", () => {
    const { rerender } = render(<Page />);
    const composer = screen.getByRole("textbox", { name: "Message" });
    const search = screen.getByRole("textbox", { name: "Search" });
    for (const init of [{ key: "k", metaKey: true }, { key: "k", ctrlKey: true }, { key: " " }, { key: "Enter" }, { key: "Escape" }, { key: "ArrowUp" }]) {
      document.body.focus();
      fireEvent.keyDown(document.body, init);
      expect(document.activeElement).not.toBe(composer);
    }
    search.focus();
    fireEvent.keyDown(search, { key: "h" });
    expect(document.activeElement).toBe(search);
    rerender(<Page enabled={false} />);
    document.body.focus();
    fireEvent.keyDown(document.body, { key: "h" });
    expect(document.activeElement).not.toBe(composer);
  });
});
