import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { seedDevUser, runMigrations } = vi.hoisted(() => ({ seedDevUser: vi.fn(), runMigrations: vi.fn() }));
vi.mock("@db/seed", () => ({ seedDevUser }));
vi.mock("@db/migrate", () => ({ runMigrations }));
vi.mock("@db/client", () => {
  const chain = { select: () => chain, from: () => chain, where: () => chain, all: () => [] };
  return { getDb: () => chain, closeDatabase: vi.fn(), schema: { generations: {} } };
});
vi.mock("@auth/admin-seed", () => ({ seedAdmin: vi.fn(async () => undefined) }));
vi.mock("@relay/orphans", () => ({ settleOrphan: vi.fn() }));
vi.mock("./shutdown", () => ({ installSignalHandlers: vi.fn(), onShutdown: vi.fn() }));
const { sentryInit } = vi.hoisted(() => ({ sentryInit: vi.fn() }));
vi.mock("@sentry/node", () => ({ init: sentryInit, flush: vi.fn() }));

const g = globalThis as unknown as { __chatBooted?: boolean };

class Exit extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${code})`);
  }
}

async function bootWith(vars: Record<string, string | undefined>): Promise<void> {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-0123456789abcdef");
  vi.stubEnv("BETTER_AUTH_URL", "https://chat.example");
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
  vi.stubEnv("REPLAY_MODE", "");
  vi.stubEnv("ADMIN_PASSWORD", undefined);
  vi.stubEnv("SENTRY_DSN", "");
  vi.stubEnv("E2E", "");
  vi.stubEnv("E2E_ALLOW_PRODUCTION", "");
  vi.stubEnv("TRUSTED_IP_HEADER", undefined);
  vi.stubEnv("TRUST_PROXY_HOPS", undefined);
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.resetModules();
  const { boot } = await import("./boot");
  await boot();
}

describe("boot: the e2e harness switches in production", () => {
  beforeEach(() => {
    delete g.__chatBooted;
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Exit(code);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    delete g.__chatBooted;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    seedDevUser.mockClear();
    runMigrations.mockClear();
  });

  it("refuses to start with NODE_ENV=production and E2E=1", async () => {
    await expect(bootWith({ NODE_ENV: "production", E2E: "1" })).rejects.toThrow(new Exit(1));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("E2E"));
    expect(runMigrations).not.toHaveBeenCalled();
    expect(seedDevUser).not.toHaveBeenCalled();
  });

  it("refuses E2E=true the same way", async () => {
    await expect(bootWith({ NODE_ENV: "production", E2E: "true" })).rejects.toThrow(new Exit(1));
    expect(seedDevUser).not.toHaveBeenCalled();
  });

  it("starts the harness's production server when E2E_ALLOW_PRODUCTION=1", async () => {
    await bootWith({ NODE_ENV: "production", E2E: "1", E2E_ALLOW_PRODUCTION: "1" });
    expect(process.exit).not.toHaveBeenCalled();
    expect(seedDevUser).toHaveBeenCalledOnce();
  });

  it("starts a plain production server without seeding the dev user", async () => {
    await bootWith({ NODE_ENV: "production" });
    expect(process.exit).not.toHaveBeenCalled();
    expect(seedDevUser).not.toHaveBeenCalled();
  });

  it("leaves development with E2E=1 alone", async () => {
    await bootWith({ NODE_ENV: "development", E2E: "1" });
    expect(process.exit).not.toHaveBeenCalled();
    expect(seedDevUser).toHaveBeenCalledOnce();
  });
});

describe("boot: a deployment's configuration", () => {
  beforeEach(() => {
    delete g.__chatBooted;
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Exit(code);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    delete g.__chatBooted;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    runMigrations.mockClear();
  });

  it("refuses to start without BETTER_AUTH_URL", async () => {
    await expect(bootWith({ NODE_ENV: "production", BETTER_AUTH_URL: undefined })).rejects.toThrow(new Exit(1));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("BETTER_AUTH_URL"));
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it("refuses to start without ANTHROPIC_API_KEY unless REPLAY_MODE asks for replay", async () => {
    await expect(bootWith({ NODE_ENV: "production", ANTHROPIC_API_KEY: undefined })).rejects.toThrow(new Exit(1));
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("ANTHROPIC_API_KEY"));
    expect(runMigrations).not.toHaveBeenCalled();
    delete g.__chatBooted;
    await bootWith({ NODE_ENV: "production", ANTHROPIC_API_KEY: undefined, REPLAY_MODE: "1" });
    expect(runMigrations).toHaveBeenCalledOnce();
  });

  it("refuses the published placeholder secrets", async () => {
    for (const secret of ["change-me-to-a-long-random-string", "dev-secret-not-for-production-0123456789"]) {
      delete g.__chatBooted;
      await expect(bootWith({ NODE_ENV: "production", BETTER_AUTH_SECRET: secret })).rejects.toThrow(new Exit(1));
    }
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("BETTER_AUTH_SECRET"));
    expect(runMigrations).not.toHaveBeenCalled();
  });

  it("refuses the placeholder admin password and one shorter than 10 characters", async () => {
    for (const password of ["change-me", "123456789"]) {
      delete g.__chatBooted;
      await expect(bootWith({ NODE_ENV: "production", ADMIN_EMAIL: "a@b.co", ADMIN_PASSWORD: password })).rejects.toThrow(new Exit(1));
    }
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("ADMIN_PASSWORD"));
    delete g.__chatBooted;
    await bootWith({ NODE_ENV: "production", ADMIN_EMAIL: "a@b.co", ADMIN_PASSWORD: "1234567890" });
    expect(runMigrations).toHaveBeenCalledOnce();
  });

  it("keeps request bodies, cookies, headers and the client address out of Sentry", async () => {
    await bootWith({ NODE_ENV: "production", SENTRY_DSN: "https://key@sentry.example/1" });
    expect(sentryInit).toHaveBeenCalledWith(
      expect.objectContaining({
        dataCollection: expect.objectContaining({ userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false }),
      }),
    );
  });

  it("warns when nothing says which proxy sets the client address", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await bootWith({ NODE_ENV: "production", TRUST_PROXY_HOPS: "" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("TRUST_PROXY_HOPS"));
    for (const vars of [{ TRUST_PROXY_HOPS: "1" }, { TRUSTED_IP_HEADER: "x-real-ip" }, { NODE_ENV: "development" }]) {
      warn.mockClear();
      delete g.__chatBooted;
      await bootWith({ NODE_ENV: "production", ...vars });
      expect(warn).not.toHaveBeenCalled();
    }
  });

  it("leaves development and the e2e harness alone", async () => {
    const placeholders = { ANTHROPIC_API_KEY: undefined, BETTER_AUTH_URL: undefined, BETTER_AUTH_SECRET: "change-me-to-a-long-random-string", ADMIN_PASSWORD: "change-me" };
    await bootWith({ NODE_ENV: "development", ...placeholders });
    delete g.__chatBooted;
    await bootWith({ NODE_ENV: "production", E2E: "1", E2E_ALLOW_PRODUCTION: "1", ...placeholders });
    expect(process.exit).not.toHaveBeenCalled();
  });
});
