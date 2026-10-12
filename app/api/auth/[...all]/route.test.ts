// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const handler = vi.hoisted(() => vi.fn(async () => new Response("ok")));
vi.mock("@auth/server", () => ({ getAuth: () => ({ handler }) }));

import { GET, POST } from "./route";

const post = (path: string) => POST(new Request(`http://localhost${path}`, { method: "POST", body: "{}" }));

beforeEach(() => handler.mockClear());

describe("/api/auth/*", () => {
  it("passes email sign-in and sign-out through to better-auth", async () => {
    expect((await post("/api/auth/sign-in/email")).status).toBe(200);
    expect((await post("/api/auth/sign-out?x=1")).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("answers 404 for every other endpoint, and for spellings of the allowed ones", async () => {
    for (const path of [
      "/api/auth/delete-anonymous-user",
      "/api/auth/update-user",
      "/api/auth/sign-in/anonymous",
      "/api/auth/change-password",
      "/api/auth/sign-in/email/",
      "/api/auth/Sign-In/Email",
      "/api/auth/sign-in/%65mail",
      "/api/auth/sign-in%2Femail",
      "/api/auth//sign-out",
    ]) {
      const res = await post(path);
      expect(res.status, path).toBe(404);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers 404 to every GET", async () => {
    expect(GET().status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});
