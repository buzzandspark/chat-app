import "server-only";
import { env } from "@shared/env";
import { getDb } from "@db/client";
import { Engine } from "@relay/engine";
import { QuotaManager } from "@relay/quota";
import { createProviderResolver } from "@relay/registry";
import { EventStore } from "@relay/store";
import { isDraining, onShutdown } from "./shutdown";

interface RelaySingleton {
  engine: Engine;
  store: EventStore;
  quota: QuotaManager;
}

const g = globalThis as unknown as { __cadenceRelay?: RelaySingleton };

/** One engine per process (D1), created lazily and cached across dev reloads. */
export function getRelay(): RelaySingleton {
  if (g.__cadenceRelay) return g.__cadenceRelay;
  const db = getDb();
  // A finished buffer is kept a minute for late resumes; after that a resume gets the saved snapshot.
  const store = new EventStore({ evictAfterMs: 60_000 });
  store.startSweeper();
  const quota = new QuotaManager(db);
  const engine = new Engine({
    db,
    store,
    quota,
    providers: createProviderResolver({ replayMode: env.replayMode, record: env.record }),
    isDraining,
  });
  // Registered after boot's closeDatabase drain, so it runs before it (LIFO).
  onShutdown(async () => {
    console.log(`[shutdown] draining ${engine.runningCount()} generation(s)`);
    await engine.drain();
    store.stopSweeper();
  });
  g.__cadenceRelay = { engine, store, quota };
  return g.__cadenceRelay;
}
