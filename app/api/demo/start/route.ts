import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getAuth } from "@auth/server";
import { getDb, schema } from "@db/client";
import { errorResponse, jsonError } from "@server/current-user";
import { isDraining } from "@server/shutdown";

/**
 * ADR-0004: "Try the demo" creates an ephemeral anonymous user with role
 * `demo` and a 24 h session. The provider resolver forces replay for demo
 * users server-side, so the demo can never spend API money.
 */
export async function POST(): Promise<Response> {
  try {
    if (isDraining()) return jsonError(503, { error: "draining" });
    const auth = getAuth();
    const reqHeaders = await headers();
    const result = await auth.api.signInAnonymous({ headers: reqHeaders, returnHeaders: true });
    const user = result.response?.user;
    if (!user) return jsonError(500, { error: "demo_failed" });
    const db = getDb();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    db.update(schema.users).set({ role: "demo", name: "Demo visitor", updatedAt: new Date() }).where(eq(schema.users.id, user.id)).run();
    db.update(schema.sessions).set({ expiresAt }).where(eq(schema.sessions.userId, user.id)).run();
    const res = Response.json({ ok: true, redirect: "/c/new" }, { headers: { "cache-control": "no-store" } });
    result.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") res.headers.append("set-cookie", value);
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
