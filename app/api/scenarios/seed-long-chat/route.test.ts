// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@db/client";
import { createTestDb, seedUser } from "@relay/test-utils";
import { requireUser } from "@server/current-user";
import { getLimiters } from "@server/ratelimit";
import type { UserRole } from "@shared/types";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
const ctx = vi.hoisted(() => ({ db: null as Db | null, isProd: true, e2e: false }));
vi.mock("@db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@db/client")>()),
  getDb: () => ctx.db,
}));
vi.mock("@shared/env", async (importOriginal) => {
  const { env } = await importOriginal<typeof import("@shared/env")>();
  return { env: Object.defineProperties({ ...env }, { isProd: { get: () => ctx.isProd }, e2e: { get: () => ctx.e2e } }) };
});
vi.mock("@server/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/current-user")>()),
  requireUser: vi.fn(),
}));

function seedAs(role: UserRole): Promise<Response> {
  vi.mocked(requireUser).mockResolvedValue({ id: "u1", role, email: "u1@example.com", name: "u1" });
  return POST();
}

const g = globalThis as unknown as { __chatLimiters?: ReturnType<typeof getLimiters> };

beforeEach(() => {
  ctx.db = createTestDb();
  seedUser(ctx.db, "u1");
  ctx.isProd = true;
  ctx.e2e = false;
});
afterEach(() => {
  for (const limiter of Object.values(g.__chatLimiters ?? {})) limiter.stopSweeper();
  delete g.__chatLimiters;
});

describe("POST /api/scenarios/seed-long-chat", () => {
  it("is closed to guests in production, and writes nothing for them", async () => {
    expect((await seedAs("guest")).status).toBe(403);
    expect(ctx.db?.query.chats.findMany().sync()).toHaveLength(0);
    expect((await seedAs("user")).status).toBe(201);
    expect((await seedAs("admin")).status).toBe(201);
  });

  it("is open outside production and to the e2e harness", async () => {
    ctx.isProd = false;
    expect((await seedAs("guest")).status).toBe(201);
    ctx.isProd = true;
    ctx.e2e = true;
    expect((await seedAs("guest")).status).toBe(201);
  });
});
