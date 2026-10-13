import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@auth/server", () => ({ getAuth: vi.fn(), SESSION_COOKIE: "session" }));
vi.mock("@db/client", () => ({ getDb: vi.fn(), schema: {} }));
const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/node", () => ({ captureException }));

async function loadWith(dsn: string) {
  vi.stubEnv("SENTRY_DSN", dsn);
  vi.resetModules();
  return import("./current-user");
}

describe("errorResponse", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    captureException.mockClear();
  });

  it("answers 500 and reports an unexpected error to Sentry when a DSN is set", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { errorResponse } = await loadWith("https://key@sentry.example/1");
    const err = new Error("disk full");
    expect(errorResponse(err).status).toBe(500);
    await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(err));
  });

  it("reports nothing for an HttpError or without a DSN", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const withDsn = await loadWith("https://key@sentry.example/1");
    expect(withDsn.errorResponse(new withDsn.HttpError(404, { error: "not_found" })).status).toBe(404);
    const { errorResponse } = await loadWith("");
    expect(errorResponse(new Error("boom")).status).toBe(500);
    await new Promise((r) => setTimeout(r, 10));
    expect(captureException).not.toHaveBeenCalled();
  });
});
