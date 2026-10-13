import type { NextRequest } from "next/server";
import type { OptionsProgress } from "@relay/options/service";
import { assertMayInteract, errorResponse, jsonError, requireUser } from "@server/current-user";
import { messageForkOptions } from "@server/messages";
import { getRelay } from "@server/relay";
import { env } from "@shared/env";
import type { OptionsEvent } from "@shared/forks";

/** The reply's fork options as JSON lines: the count first, the options as they complete, then the final list, or an error. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/messages/[id]/options">): Promise<Response> {
  try {
    const user = await requireUser();
    assertMayInteract(user);
    const { id } = await ctx.params;
    const stored = messageForkOptions(user.id, id);
    if (!stored.ok) return jsonError(stored.error === "not_found" ? 404 : 403, { error: stored.error });
    const service = getRelay().options;
    const asked = performance.now();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let stop = () => {};
        let sentCount = false;
        let sentOptions = 0;
        const send = (event: OptionsEvent) => {
          if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        const timer = setTimeout(() => {
          send({ error: true });
          close();
        }, 30_000);
        const close = () => {
          if (closed) return;
          closed = true;
          clearTimeout(timer);
          stop();
          try {
            controller.close();
          } catch {
            // already closed by the reader
          }
        };
        const emit = (state: OptionsProgress) => {
          if (state.done) {
            const trace = env.isProd || state.failed ? null : service.takeTrace(id);
            send(state.failed ? { error: true } : { count: state.options.length, options: state.options, done: true, trace: trace && { ...trace, waitedMs: Math.round(performance.now() - asked) } });
            close();
            return;
          }
          if (state.count !== null && !sentCount) {
            sentCount = true;
            send({ count: state.count });
          }
          if (state.options.length > sentOptions) {
            sentOptions = state.options.length;
            send({ options: state.options });
          }
        };
        request.signal.addEventListener("abort", close, { once: true });
        const watched = service.watch(id, emit);
        if (!watched) {
          send({ count: stored.value?.length ?? 0, options: stored.value ?? [], done: true, trace: null });
          close();
          return;
        }
        stop = watched.stop;
        emit(watched.state);
      },
    });
    // no-transform: Next's response compression would otherwise hold the lines back until the end.
    return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform" } });
  } catch (err) {
    return errorResponse(err);
  }
}
