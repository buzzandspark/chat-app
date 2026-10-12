import "server-only";
import { env } from "@shared/env";
import { getDb } from "@db/client";
import { Engine } from "@relay/engine";
import { OptionsService } from "@relay/options/service";
import { QuotaManager } from "@relay/quota";
import { createProviderResolver } from "@relay/registry";
import { EventStore } from "@relay/store";
import { isDraining, onShutdown } from "./shutdown";

interface RelaySingleton {
  engine: Engine;
  store: EventStore;
  quota: QuotaManager;
  options: OptionsService;
}

const g = globalThis as unknown as { __chatRelay?: RelaySingleton };

/** One engine per process (D1), created lazily and cached across dev reloads. */
export function getRelay(): RelaySingleton {
  if (g.__chatRelay) return g.__chatRelay;
  const db = getDb();
  // A finished buffer is kept a minute for late resumes; after that a resume gets the saved snapshot.
  const store = new EventStore({ evictAfterMs: 60_000 });
  store.startSweeper();
  const quota = new QuotaManager(db);
  const options = new OptionsService({ db, replayMode: env.replayMode });
  const engine = new Engine({
    db,
    store,
    quota,
    providers: createProviderResolver({ replayMode: env.replayMode, record: env.record }),
    isDraining,
    afterDone: (info) => options.onReplyDone(info),
  });
  // Registered after boot's closeDatabase drain, so it runs before it (LIFO).
  onShutdown(async () => {
    console.log(`[shutdown] draining ${engine.runningCount()} generation(s)`);
    await engine.drain();
    store.stopSweeper();
  });
  g.__chatRelay = { engine, store, quota, options };
  return g.__chatRelay;
}
