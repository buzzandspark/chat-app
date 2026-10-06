import { connection } from "next/server";
import { openDatabase } from "@db/client";

export async function GET() {
  await connection();
  let sqlite: "ok" | "error" = "ok";
  try {
    openDatabase().sqlite.prepare("select 1").get();
  } catch {
    sqlite = "error";
  }
  return Response.json(
    { ok: sqlite === "ok", sqlite, uptime: Math.round(process.uptime()) },
    { status: sqlite === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
