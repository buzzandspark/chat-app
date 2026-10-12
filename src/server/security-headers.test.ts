import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "@/next.config";

// Next applies every matching `headers()` entry in order; for a repeated key the last one wins.
async function headersFor(pathname: string): Promise<Record<string, string>> {
  const rules = (await nextConfig.headers?.()) ?? [];
  const out: Record<string, string> = {};
  for (const rule of rules) {
    if (!getPathMatch(rule.source)(pathname)) continue;
    for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
  }
  return out;
}

describe("next.config security headers", () => {
  it("does not advertise the framework", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });

  it.each(["/", "/login", "/c/abc", "/api/health", "/api/generations/g1/events", "/invite/tok"])(
    "%s cannot be framed or sniffed",
    async (path) => {
      const h = await headersFor(path);
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(h["x-frame-options"]).toBe("DENY");
    },
  );

  it("keeps no-referrer on the invite page and strict-origin-when-cross-origin elsewhere", async () => {
    expect((await headersFor("/invite/tok"))["referrer-policy"]).toBe("no-referrer");
    expect((await headersFor("/login"))["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
