import type { NextRequest } from "next/server";
import { eq, max } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@db/client";
import { errorResponse, jsonError, requireUser } from "@server/current-user";
import { uuidv7 } from "@shared/id";

const Body = z.object({ name: z.string().trim().min(1).max(60) });

/** A new sidebar group, placed after the user's existing ones. */
export async function POST(request: NextRequest): Promise<Response> {
  try {
    const user = await requireUser();
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return jsonError(400, { error: "bad_request" });
    const db = getDb();
    const last = db.select({ position: max(schema.chatGroups.position) }).from(schema.chatGroups).where(eq(schema.chatGroups.userId, user.id)).get();
    const group = { id: uuidv7(), userId: user.id, name: parsed.data.name, position: (last?.position ?? -1) + 1, collapsed: false, createdAt: new Date() };
    db.insert(schema.chatGroups).values(group).run();
    return Response.json(
      { id: group.id, name: group.name, position: group.position, collapsed: group.collapsed },
      { status: 201, headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
