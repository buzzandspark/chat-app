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

const g = globalThis as unknown as { __cadenceBooted?: boolean };

class Exit extends Error {
  constructor(readonly code: number | string | null | undefined) {
    super(`process.exit(${code})`);
  }
}

async function bootWith(vars: Record<string, string>): Promise<void> {
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-0123456789abcdef");
  vi.stubEnv("SENTRY_DSN", "");
  vi.stubEnv("E2E", "");
  vi.stubEnv("E2E_ALLOW_PRODUCTION", "");
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.resetModules();
  const { boot } = await import("./boot");
  await boot();
}

describe("boot: the e2e harness switches in production", () => {
  beforeEach(() => {
    delete g.__cadenceBooted;
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Exit(code);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    delete g.__cadenceBooted;
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
