// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { PASSWORD_MAX_LENGTH } from "@shared/types";
import { POST } from "./route";

vi.mock("server-only", () => ({}));
const redeemInvite = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, user: { email: "ada@example.com" } })));
vi.mock("@auth/invites", () => ({ redeemInvite }));

const redeem = (password: string) =>
  POST(new NextRequest("http://localhost/api/invite/t", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }), {
    params: Promise.resolve({ token: "t" }),
  });

describe("POST /api/invite/:token", () => {
  it("refuses a password sign-in would refuse, without using up the invite", async () => {
    const res = await redeem("x".repeat(PASSWORD_MAX_LENGTH + 1));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "weak_password" });
    expect(redeemInvite).not.toHaveBeenCalled();

    expect((await redeem("x".repeat(PASSWORD_MAX_LENGTH))).status).toBe(200);
    expect(redeemInvite).toHaveBeenCalledOnce();
  });
});
