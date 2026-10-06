import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins like clsx and dedupes", () => {
    expect(cn("a", false && "b", undefined, ["c", { d: true, e: false }], "a")).toBe("a c d");
  });
  it("later classes win within a conflict family", () => {
    expect(cn("size-8 rounded-lg px-2", "size-10 rounded-full")).toBe("px-2 size-10 rounded-full");
    expect(cn("h-8 text-sm", "h-11 text-body")).toBe("h-11 text-body");
    expect(cn("bg-primary text-primary-foreground", "bg-muted")).toBe("text-primary-foreground bg-muted");
  });
  it("keeps variants separate", () => {
    expect(cn("h-8 md:h-10", "h-11")).toBe("md:h-10 h-11");
    expect(cn("hover:bg-muted", "bg-background", "hover:bg-accent")).toBe("bg-background hover:bg-accent");
    expect(cn("[&_svg]:size-4", "size-10")).toBe("[&_svg]:size-4 size-10");
  });
  it("does not confuse colour and size text utilities", () => {
    expect(cn("text-sm text-muted-foreground", "text-body")).toBe("text-muted-foreground text-body");
    expect(cn("text-sm text-muted-foreground", "text-foreground")).toBe("text-sm text-foreground");
  });
  it("treats negative and positive values as the same family", () => {
    expect(cn("-translate-y-1/2", "translate-y-0")).toBe("translate-y-0");
  });
  it("passes unknown utilities through", () => {
    expect(cn("touch-target safe-x", "group/button")).toBe("touch-target safe-x group/button");
  });
});
