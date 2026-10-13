"use client";
import { busyText } from "@client/components/chat/rate-limit";
import { readJson, type RewriteResponse } from "@shared/api";
import type { ForkOption } from "@shared/forks";
import { CAP, logOptionsTrace } from "./forks";

// The fork sheet's only call, kept out of forks.ts so it loads with the sheet's chunk, not the chat route.

export type RewriteOutcome = { ok: true; options: ForkOption[] } | { ok: false; error: string };

export async function rewriteOptions(messageId: string, instruction: string, options: readonly ForkOption[]): Promise<RewriteOutcome> {
  const asked = performance.now();
  try {
    const res = await fetch(`/api/messages/${messageId}/options/rewrite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction, options }),
    });
    if (res.status === 429) return { ok: false, error: busyText(Number(res.headers.get("retry-after")) * 1000) };
    if (!res.ok) return { ok: false, error: res.status === 402 ? CAP : res.status === 403 ? "Guests can't use Explore right now. Sign in to continue." : `Could not apply the instruction (${res.status}).` };
    const data = await readJson<RewriteResponse>(res);
    // The server sends traces only in development; the check lets production builds drop the logging.
    if (process.env.NODE_ENV !== "production" && data.trace) logOptionsTrace("rewrite", data.trace, performance.now() - asked);
    // A cut-off or refused answer comes back as no options.
    if (data.options.length === 0) return { ok: false, error: "Could not apply the instruction. Try again." };
    return { ok: true, options: data.options };
  } catch {
    return { ok: false, error: "You seem to be offline." };
  }
}
