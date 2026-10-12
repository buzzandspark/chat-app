import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Imports are hoisted above this file's code; the database path has to be set before @db/client loads.
const dbPath = vi.hoisted(() => {
  const p = `${process.env.TMPDIR ?? "/tmp"}/chat-auth-${process.pid}-${Date.now()}/app.db`;
  process.env.DATABASE_PATH = p;
  return p;
});

import { closeDatabase, getDb, openDatabase, schema } from "@db/client";
import { applyMigrations } from "@db/migrator";
import { seedAdmin } from "./admin-seed";
import { getAuth } from "./server";

const ORIGIN = "http://localhost:3000";
const ADMIN_EMAIL = "admin@example.com";
const ADMIN_PASSWORD = "admin-password-123";

function call(route: string, init: { method?: string; body?: unknown; cookie?: string } = {}): Promise<Response> {
  const method = init.method ?? "POST";
  const headers: Record<string, string> = { origin: ORIGIN };
  if (init.cookie) headers.cookie = init.cookie;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  return getAuth().handler(
    new Request(`${ORIGIN}/api/auth${route}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
  );
}

async function signIn(email: string, password: string): Promise<{ res: Response; cookie: string }> {
  const res = await call("/sign-in/email", { body: { email, password } });
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");
  return { res, cookie };
}

/** Every HTTP endpoint the admin plugin registers, read from the plugin itself so a new one is covered too. */
function adminPluginEndpoints(): { path: string; method: string }[] {
  const plugin = getAuth().options.plugins.find((p) => p.id === "admin");
  if (!plugin?.endpoints) throw new Error("admin plugin not registered");
  return Object.values(plugin.endpoints).map((e) => {
    const m: string | string[] = e.options.method;
    return { path: e.path, method: Array.isArray(m) ? m[0]! : m };
  });
}

let adminCookie = "";

beforeAll(async () => {
  applyMigrations(openDatabase().sqlite);
  await seedAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
  const { res, cookie } = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
  expect(res.status).toBe(200);
  adminCookie = cookie;
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

describe("better-auth over HTTP", () => {
  it("still signs in and returns the session with the admin plugin's fields", async () => {
    const res = await call("/get-session", { method: "GET", cookie: adminCookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string; role: string; banned: boolean } };
    expect(body.user).toMatchObject({ email: ADMIN_EMAIL, role: "admin", banned: false });
  });

  it("refuses a banned user's sign-in (the plugin's session hook stays on)", async () => {
    const email = "banned@example.com";
    await seedAdmin(email, ADMIN_PASSWORD);
    getDb().update(schema.users).set({ role: "user", banned: true }).where(eq(schema.users.email, email)).run();
    const { res } = await signIn(email, ADMIN_PASSWORD);
    expect(res.status).toBe(403);
  });

  it("does not let an admin session create an uncapped user through /admin/create-user", async () => {
    const email = "uncapped@example.com";
    const res = await call("/admin/create-user", {
      cookie: adminCookie,
      body: { email, password: "password-1234", name: "Uncapped", role: "admin" },
    });
    // Without the guard this row would exist with role "admin" and cost_cap_usd NULL, which the quota reads as uncapped.
    expect(getDb().select().from(schema.users).where(eq(schema.users.email, email)).get()).toBeUndefined();
    expect(res.status).toBe(404);
  });

  it("does not let an admin session reset a user's spend through /admin/update-user", async () => {
    const admin = getDb().select().from(schema.users).where(eq(schema.users.email, ADMIN_EMAIL)).get()!;
    getDb().update(schema.users).set({ costSpentUsd: 5 }).where(eq(schema.users.id, admin.id)).run();
    const res = await call("/admin/update-user", { cookie: adminCookie, body: { userId: admin.id, data: { costSpentUsd: 0 } } });
    expect(getDb().select().from(schema.users).where(eq(schema.users.id, admin.id)).get()!.costSpentUsd).toBe(5);
    expect(res.status).toBe(404);
  });

  it("refuses every admin plugin endpoint, including trailing-slash, case and percent-encoded variants", async () => {
    const endpoints = adminPluginEndpoints();
    expect(endpoints.length).toBeGreaterThan(10);
    for (const { path: route, method } of endpoints) {
      for (const variant of [route, `${route}/`, route.toUpperCase(), route.replace("/admin/", "/%61dmin/")]) {
        const res = await call(variant, method === "GET" ? { method, cookie: adminCookie } : { method, cookie: adminCookie, body: {} });
        expect({ variant, method, status: res.status }).toEqual({ variant, method, status: 404 });
      }
    }
  });

  it("keeps the session cookie valid afterwards", async () => {
    const res = await call("/get-session", { method: "GET", cookie: adminCookie });
    expect(res.status).toBe(200);
  });
});
