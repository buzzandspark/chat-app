import { describe, expect, it } from "vitest";
import { redactInvitePath, redactInviteTokens } from "./redact";

const TOKEN = "q3Z-_x9KfLm0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0u";

describe("redactInvitePath", () => {
  it("redacts the token in a path, a full URL, the API route and a transaction name", () => {
    expect(redactInvitePath(`/invite/${TOKEN}`)).toBe("/invite/[redacted]");
    expect(redactInvitePath(`https://chat.example/invite/${TOKEN}?x=1#y`)).toBe(
      "https://chat.example/invite/[redacted]?x=1#y",
    );
    expect(redactInvitePath(`POST /api/invite/${TOKEN}`)).toBe("POST /api/invite/[redacted]");
    expect(redactInvitePath(`/invite/${TOKEN}/`)).toBe("/invite/[redacted]/");
    expect(redactInvitePath(`/invite/abc%2Fdef`)).toBe("/invite/[redacted]");
  });

  it("redacts every occurrence in one string", () => {
    expect(redactInvitePath(`from /invite/${TOKEN} to /invite/other`)).toBe(
      "from /invite/[redacted] to /invite/[redacted]",
    );
  });

  it("leaves other paths, route files and redacted strings alone", () => {
    for (const text of [
      "/c/0191e2a0-0000-7000-8000-000000000000",
      "/api/admin/users/u1/invite",
      "app/(auth)/invite/[token]/page.tsx",
      "/invite/[redacted]",
      "/login?next=%2Fc%2Fnew",
    ]) {
      expect(redactInvitePath(text)).toBe(text);
    }
  });
});

describe("redactInviteTokens", () => {
  it("redacts every string in a Sentry-shaped event without touching the original", () => {
    const event = {
      transaction: `GET /invite/${TOKEN}`,
      request: { url: `https://chat.example/invite/${TOKEN}`, headers: { referer: `https://chat.example/invite/${TOKEN}` } },
      exception: { values: [{ value: `Failed to fetch /api/invite/${TOKEN}`, stacktrace: { frames: [{ filename: "app/(auth)/invite/[token]/page.tsx", lineno: 3 }] } }] },
      breadcrumbs: [{ category: "navigation", data: { from: `/invite/${TOKEN}`, to: "/c/x" } }],
      extra: { path: `/invite/${TOKEN}`, method: "GET", count: 2, ok: true, none: null },
    };
    const out = redactInviteTokens(event);
    expect(JSON.stringify(out)).not.toContain(TOKEN);
    expect(out.transaction).toBe("GET /invite/[redacted]");
    expect(out.request.headers.referer).toBe("https://chat.example/invite/[redacted]");
    expect(out.exception.values[0]?.stacktrace.frames[0]).toEqual({ filename: "app/(auth)/invite/[token]/page.tsx", lineno: 3 });
    expect(out.breadcrumbs[0]?.data).toEqual({ from: "/invite/[redacted]", to: "/c/x" });
    expect(out.extra).toEqual({ path: "/invite/[redacted]", method: "GET", count: 2, ok: true, none: null });
    expect(event.request.url).toContain(TOKEN);
  });

  it("survives a cycle and leaves class instances as they are", () => {
    const when = new Date(0);
    const extra: Record<string, unknown> = { path: `/invite/${TOKEN}`, when };
    extra.self = extra;
    const out = redactInviteTokens({ extra });
    expect(out.extra.path).toBe("/invite/[redacted]");
    expect(out.extra.self).toBe(out.extra);
    expect(out.extra.when).toBe(when);
  });
});
