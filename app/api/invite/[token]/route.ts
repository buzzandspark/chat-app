import type { NextRequest } from "next/server";
import { z } from "zod";
import { redeemInvite } from "@auth/invites";
import { errorResponse, jsonError } from "@server/current-user";
import type { RedeemInviteResponse } from "@shared/api";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@shared/types";

const Body = z.object({ password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH) });

/** Single use; the token is never stored, only its hash. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/invite/[token]">): Promise<Response> {
  try {
    const { token } = await ctx.params;
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "weak_password" });
    const result = await redeemInvite(token, parsed.data.password);
    if (!result.ok) return jsonError(410, { error: result.reason });
    return Response.json({ ok: true, email: result.user.email } satisfies RedeemInviteResponse, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
