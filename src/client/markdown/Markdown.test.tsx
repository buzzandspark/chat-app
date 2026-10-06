import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

afterEach(cleanup);

describe("Markdown", () => {
  it("renders headings, lists, links, and tables", () => {
    const { container } = render(
      <Markdown
        streaming={false}
        text={
          "# Title\n\nSome **bold** and a [link](https://example.com).\n\n- one\n- two\n\n| a | b |\n|---|--:|\n| 1 | 2 |"
        }
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Title");
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    const link = screen.getByRole("link", { name: "link" });
    expect(link).toHaveAttribute("href", "https://example.com");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("td")).toHaveLength(2);
    expect(container.querySelectorAll("th")[1]).toHaveClass("text-right");
  });

  it("renders an unclosed fence as plain monospace without highlight spans", () => {
    const { container } = render(<Markdown streaming text={"```ts\nconst a = 1;\nconst b"} />);
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre).toHaveTextContent("const a = 1;");
    expect(container.querySelector("[data-shiki]")).toBeNull();
    expect(container.querySelector(".markdown-code")).toHaveAttribute("data-closed", "false");
  });

  it("renders a partial table from the rows received so far", () => {
    const { container } = render(<Markdown streaming text={"| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4"} />);
    expect(container.querySelectorAll("th")).toHaveLength(2);
    // The incomplete trailing row is skipped while streaming.
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("renders the complete rows once streaming has finished", () => {
    const { container } = render(<Markdown streaming={false} text={"| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4"} />);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("renders a table header alone while the delimiter row is still arriving", () => {
    const { container } = render(<Markdown streaming text={"| a | b |\n|---|--"} />);
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("never injects raw HTML from the input", () => {
    const { container } = render(
      <Markdown streaming={false} text={'<script>alert(1)</script>\n\nInline <img src=x onerror=alert(1)> here'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("drops unsafe link protocols", () => {
    const { container } = render(<Markdown streaming={false} text={"[x](javascript:alert(1))"} />);
    const a = container.querySelector("a");
    expect(a).not.toBeNull();
    expect(a).not.toHaveAttribute("href");
  });

  it("does not re-render finished blocks while the trailing block grows", () => {
    const onBlockRender = vi.fn();
    const { rerender } = render(
      <Markdown streaming text={"first paragraph\n\nsecond paragraph\n\nthird"} onBlockRender={onBlockRender} />,
    );
    const initial = onBlockRender.mock.calls.map((c) => c[0]);
    expect(initial).toEqual(["b0-other", "b1-other", "b2-other"]);
    onBlockRender.mockClear();
    rerender(
      <Markdown
        streaming
        text={"first paragraph\n\nsecond paragraph\n\nthird grows here"}
        onBlockRender={onBlockRender}
      />,
    );
    expect(onBlockRender.mock.calls.map((c) => c[0])).toEqual(["b2-other"]);
  });
});
