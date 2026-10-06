import type { NextRequest } from "next/server";
import { issueInvite, revokeInvites } from "@auth/invites";
import { env } from "@shared/env";
import { errorResponse, jsonError, requireAdmin } from "@server/current-user";
import { findUser } from "@server/admin";

/** D23: issue or regenerate an invite link (also the password-reset flow). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/admin/users/[id]/invite">): Promise<Response> {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    if (!findUser(id)) return jsonError(404, { error: "not_found" });
    const invite = issueInvite(id);
    const base = env.BETTER_AUTH_URL ?? new URL(request.url).origin;
    return Response.json(
      { inviteUrl: `${base}/invite/${invite.token}`, expiresAt: invite.expiresAt.getTime() },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/admin/users/[id]/invite">): Promise<Response> {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    if (!findUser(id)) return jsonError(404, { error: "not_found" });
    revokeInvites(id);
    return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
