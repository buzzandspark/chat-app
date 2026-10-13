import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const ctx = vi.hoisted(() => {
  const p = `${process.env.TMPDIR ?? "/tmp"}/chat-refresh-${process.pid}-${Date.now()}/app.db`;
  process.env.DATABASE_PATH = p;
  return { dbPath: p, headers: new Headers() };
});
vi.mock("next/headers", () => ({ headers: async () => ctx.headers }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

import { closeDatabase, getDb, openDatabase, schema } from "@db/client";
import { applyMigrations } from "@db/migrator";
import { seedAdmin } from "@auth/admin-seed";
import { getAuth } from "@auth/server";
import { getCurrentUser, requireUser } from "./current-user";

const ORIGIN = "http://localhost:3000";
const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  applyMigrations(openDatabase().sqlite);
  await seedAdmin("admin@example.com", "admin-password-123");
  const res = await getAuth().handler(
    new Request(`${ORIGIN}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@example.com", password: "admin-password-123" }),
    }),
  );
  expect(res.status).toBe(200);
  ctx.headers = new Headers({ cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") });
});

afterAll(() => {
  closeDatabase();
  fs.rmSync(path.dirname(ctx.dbPath), { recursive: true, force: true });
});

describe("the daily session refresh", () => {
  const expiresAt = () => getDb().select({ at: schema.sessions.expiresAt }).from(schema.sessions).get()?.at.getTime();

  it("is left to route handlers: a page render can't send the new cookie, so it doesn't extend the session", async () => {
    // Signed in a day and a half ago, so the next session read is due to refresh it.
    const due = new Date(Date.now() + 5.5 * DAY);
    getDb().update(schema.sessions).set({ expiresAt: due }).run();

    expect(await getCurrentUser()).toMatchObject({ email: "admin@example.com" });
    expect(expiresAt()).toBe(due.getTime());

    expect(await requireUser()).toMatchObject({ email: "admin@example.com" });
    expect(expiresAt()).toBeGreaterThan(Date.now() + 6.9 * DAY);
  });
});
