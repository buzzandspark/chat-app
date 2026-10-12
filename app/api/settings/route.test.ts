// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@db/client";
import { createTestDb, seedUser } from "@relay/test-utils";
import { HttpError, requireUser } from "@server/current-user";
import { getUserSettings } from "@server/settings";
import { PATCH } from "./route";

vi.mock("server-only", () => ({}));
const testDb = vi.hoisted(() => ({ current: null as Db | null }));
vi.mock("@db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@db/client")>()),
  getDb: () => testDb.current,
}));
vi.mock("@server/current-user", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@server/current-user")>()),
  requireUser: vi.fn(),
}));

function patch(body: unknown): Promise<Response> {
  return PATCH(new NextRequest("http://localhost/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));
}

beforeEach(() => {
  const db = createTestDb();
  seedUser(db, "u1");
  testDb.current = db;
  vi.mocked(requireUser).mockResolvedValue({ id: "u1", role: "user", email: "u1@example.com", name: "u1" });
});

describe("PATCH /api/settings", () => {
  it("turns Explore options off and on for the signed-in user, uncached", async () => {
    const off = await patch({ exploreOptions: false });
    expect(off.status).toBe(200);
    expect(off.headers.get("cache-control")).toBe("no-store");
    expect(await off.json()).toEqual({ exploreOptions: false });
    expect(getUserSettings("u1").exploreOptions).toBe(false);
    await patch({ exploreOptions: true });
    expect(getUserSettings("u1").exploreOptions).toBe(true);
  });

  it("refuses a body that is not a boolean preference", async () => {
    for (const body of [{}, { exploreOptions: "no" }, { exploreOptions: null }, "not json"]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "bad_request" });
    }
    expect(getUserSettings("u1").exploreOptions).toBe(true);
  });

  it("requires a session", async () => {
    vi.mocked(requireUser).mockRejectedValue(new HttpError(401, { error: "unauthorized" }));
    const res = await patch({ exploreOptions: false });
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(getUserSettings("u1").exploreOptions).toBe(true);
  });

  it("answers 404 for a session whose user row is gone", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "gone", role: "user", email: "gone@example.com", name: "gone" });
    expect((await patch({ exploreOptions: false })).status).toBe(404);
  });
});
