"use client";
import type { ForkOption, OptionsTrace } from "@shared/forks";
import { CAP, logOptionsTrace } from "./forks";

// The fork sheet's only call, kept out of forks.ts so it loads with the sheet's chunk, not the chat route.

export type RewriteOutcome = { ok: true; options: ForkOption[] } | { ok: false; error: string };

/** The sheet's instruction applied to every prompt; the call's trace goes to the console in development. */
export async function rewriteOptions(messageId: string, instruction: string, options: readonly ForkOption[]): Promise<RewriteOutcome> {
  const asked = performance.now();
  try {
    const res = await fetch(`/api/messages/${messageId}/options/rewrite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instruction, options }),
    });
    if (!res.ok) return { ok: false, error: res.status === 402 ? CAP : `Could not apply the instruction (${res.status}).` };
    const data = (await res.json()) as { options: ForkOption[]; trace?: OptionsTrace | null };
    // The server sends traces only in development; the check lets production builds drop the logging.
    if (process.env.NODE_ENV !== "production" && data.trace) logOptionsTrace("rewrite", data.trace, performance.now() - asked);
    return { ok: true, options: data.options };
  } catch {
    return { ok: false, error: "You seem to be offline." };
  }
}
