import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("safeNext", () => {
  it("keeps a path on this site, with its query and hash", () => {
    expect(safeNext("/c")).toBe("/c");
    expect(safeNext("/c/abc?x=1#m")).toBe("/c/abc?x=1#m");
    expect(safeNext("/settings")).toBe("/settings");
  });

  it("never yields another origin or a protocol-relative path", () => {
    for (const raw of ["/.//evil.com", "//evil.com", "/\\evil.com", "\\\\evil.com", "/\t/evil.com", "/\n/evil.com", "/%2F/evil.com", "/./\\evil.com", "/..//evil.com"]) {
      const out = safeNext(raw);
      if (out === null) continue;
      expect(out.startsWith("/")).toBe(true);
      expect(out.startsWith("//")).toBe(false);
      expect(out.startsWith("/\\")).toBe(false);
      expect(new URL(out, "https://app.example").origin).toBe("https://app.example");
    }
    expect(safeNext("/.//evil.com")).toBe("/evil.com");
  });

  it("refuses absolute URLs, other schemes and empty input", () => {
    for (const raw of ["https://evil.com/c", "javascript:alert(1)", "data:text/html,x", "", null, undefined]) expect(safeNext(raw)).toBeNull();
  });
});
