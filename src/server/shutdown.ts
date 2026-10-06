import "server-only";

type Drain = () => Promise<void> | void;

interface ShutdownState {
  draining: boolean;
  drains: Drain[];
  installed: boolean;
}

const g = globalThis as unknown as { __cadenceShutdown?: ShutdownState };
const state: ShutdownState = (g.__cadenceShutdown ??= { draining: false, drains: [], installed: false });

/** True once a termination signal has arrived; new generations are refused. */
export function isDraining(): boolean {
  return state.draining;
}

/** Register work to run before exit, in registration order. */
export function onShutdown(drain: Drain): void {
  state.drains.push(drain);
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
      for (const drain of state.drains) {
        try {
          await drain();
        } catch (err) {
          console.error("[shutdown] drain failed", err);
        }
      }
      console.log(`[shutdown] drained in ${Date.now() - started}ms`);
      process.exit(code);
    })();
  };
  process.on("SIGTERM", handle);
  process.on("SIGINT", handle);
}
