import "server-only";
import { openStreams, waitForStreamsToClose } from "./streams";

type Drain = () => Promise<void> | void;
/** "drain" work runs first (LIFO); "close" work runs after connected clients have had their last bytes. */
type Phase = "drain" | "close";

interface ShutdownState {
  draining: boolean;
  drains: Drain[];
  closers: Drain[];
  installed: boolean;
}

const g = globalThis as unknown as { __chatShutdown?: ShutdownState };
const state: ShutdownState = (g.__chatShutdown ??= { draining: false, drains: [], closers: [], installed: false });
state.closers ??= [];

/** True once a termination signal has arrived; new generations are refused. */
export function isDraining(): boolean {
  return state.draining;
}

/** Register work to run before exit; drains run last-registered first, closers after the streams have flushed (#70). */
export function onShutdown(drain: Drain, phase: Phase = "drain"): void {
  (phase === "close" ? state.closers : state.drains).push(drain);
}

export function installSignalHandlers(gracePeriodMs = 25_000): void {
  if (state.installed) return;
  state.installed = true;
  const handle = (signal: NodeJS.Signals) => {
    if (state.draining) return;
    state.draining = true;
    const code = signal === "SIGINT" ? 130 : 143;
    const timer = setTimeout(() => {
      console.error(`[shutdown] grace period elapsed, exiting ${code}`);
      process.exit(code);
    }, gracePeriodMs);
    timer.unref();
    void (async () => {
      const started = Date.now();
      console.log(`[shutdown] ${signal} received, draining ${state.drains.length} task(s)`);
      // Last registered, first drained: the engine (registered lazily) must
      // finish writing before the database (registered at boot) closes.
      for (const drain of [...state.drains].reverse()) {
        try {
          await drain();
        } catch (err) {
          console.error("[shutdown] drain failed", err);
        }
      }
      // Let connected clients receive their terminal events before the sockets die; the database
      // closes only after that, so a late persist never finds it gone.
      const pending = openStreams();
      if (pending > 0) {
        console.log(`[shutdown] waiting for ${pending} stream(s) to flush`);
        await waitForStreamsToClose(2000);
      }
      await new Promise((r) => setTimeout(r, 100));
      for (const closer of [...state.closers].reverse()) {
        try {
          await closer();
        } catch (err) {
          console.error("[shutdown] close failed", err);
        }
      }
      console.log(`[shutdown] drained in ${Date.now() - started}ms`);
      process.exit(code);
    })();
  };
  process.on("SIGTERM", handle);
  process.on("SIGINT", handle);
}
