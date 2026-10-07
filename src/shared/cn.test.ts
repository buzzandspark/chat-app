import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins like clsx and resolves conflicts, last one wins", () => {
    expect(cn("a", false && "b", ["c", { d: true }])).toBe("a c d");
    expect(cn("size-8 rounded-lg px-2", "size-10 rounded-full")).toBe("px-2 size-10 rounded-full");
  });
  it("keeps distinct sides of the same box", () => {
    expect(cn("fixed top-1/2 left-1/2", "left-0")).toBe("fixed top-1/2 left-0");
    expect(cn("inset-y-0 right-0", "h-full")).toBe("inset-y-0 right-0 h-full");
  });
  it("knows the app's custom text sizes and radii", () => {
    expect(cn("text-sm text-muted-foreground", "text-body")).toBe("text-muted-foreground text-body");
    expect(cn("rounded-xl", "rounded-t-sheet")).toBe("rounded-xl rounded-t-sheet");
    expect(cn("rounded-lg", "rounded-bubble")).toBe("rounded-bubble");
  });
});
