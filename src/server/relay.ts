import "server-only";
import { env } from "@shared/env";
import { getDb, type Db } from "@db/client";
import { Budgets } from "@relay/budgets";
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

export function createQuota(db: Db): QuotaManager {
  return new QuotaManager(db, {
    maxPromptTokens: env.GUEST_MAX_PROMPT_TOKENS,
    budgets: new Budgets(db, { ip: env.GUEST_IP_USD_PER_DAY, ip48: env.GUEST_IP48_USD_PER_DAY, all: env.GUEST_ALL_USD_PER_DAY }),
  });
}

/** One engine per process, created lazily and cached across dev reloads. */
export function getRelay(): RelaySingleton {
  if (g.__chatRelay) return g.__chatRelay;
  const db = getDb();
  // A finished buffer is kept a minute for late resumes; after that a resume gets the saved snapshot.
  const store = new EventStore({ evictAfterMs: 60_000 });
  store.startSweeper();
  const quota = createQuota(db);
  const options = new OptionsService({ db, replayMode: env.replayMode, quota });
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
