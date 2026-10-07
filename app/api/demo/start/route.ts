import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getAuth } from "@auth/server";
import { getDb, schema } from "@db/client";
import { errorResponse, jsonError } from "@server/current-user";
import { clientIp, getLimiters, tooMany } from "@server/ratelimit";
import { isDraining } from "@server/shutdown";

/** ADR-0004: anonymous demo user with a 24 h session; the provider resolver forces replay for `demo`. */
export async function POST(request: Request): Promise<Response> {
  try {
    if (isDraining()) return jsonError(503, { error: "draining" });
    const limit = getLimiters().demoStart.check(clientIp(request));
    if (!limit.ok) return tooMany(limit.retryAfterMs);
    const auth = getAuth();
    const reqHeaders = await headers();
    // A returning visitor: a live demo session is reused; an expired or purged one must not block a new one.
    const existing = await auth.api.getSession({ headers: reqHeaders }).catch(() => null);
    const current = existing?.user as { id: string; role?: string | null; banned?: boolean | null } | undefined;
    if (current && current.role === "demo" && !current.banned) {
      return Response.json({ ok: true, reused: true }, { headers: { "cache-control": "no-store" } });
    }
    const fresh = new Headers(reqHeaders);
    fresh.delete("cookie");
    const result = await auth.api.signInAnonymous({ headers: fresh, returnHeaders: true });
    const user = result.response?.user;
    if (!user) return jsonError(500, { error: "demo_failed" });
    const db = getDb();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    db.update(schema.users).set({ role: "demo", name: "Demo visitor", updatedAt: new Date() }).where(eq(schema.users.id, user.id)).run();
    db.update(schema.sessions).set({ expiresAt }).where(eq(schema.sessions.userId, user.id)).run();
    const res = Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    result.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") res.headers.append("set-cookie", value);
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
