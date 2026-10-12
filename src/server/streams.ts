import "server-only";

interface StreamRegistry {
  open: number;
  waiters: Array<() => void>;
}

const g = globalThis as unknown as { __chatStreams?: StreamRegistry };
const registry: StreamRegistry = (g.__chatStreams ??= { open: 0, waiters: [] });

/** Counts open SSE responses so shutdown can let their last bytes flush. */
export function streamOpened(): void {
  registry.open++;
}

export function streamClosed(): void {
  registry.open = Math.max(0, registry.open - 1);
  if (registry.open === 0) {
    const waiters = registry.waiters.splice(0);
    for (const w of waiters) w();
  }
}

export function openStreams(): number {
  return registry.open;
}

export function waitForStreamsToClose(timeoutMs: number): Promise<void> {
  if (registry.open === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    registry.waiters.push(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}
