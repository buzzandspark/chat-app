import { eq } from "drizzle-orm";
import type { Db } from "@db/client";
import { chats, generations, messages, usageEvents, users } from "@db/schema";
import type { ForkOption } from "@shared/forks";
import { uuidv7 } from "@shared/id";
import { costOf, type TokenCounts } from "../anthropic/pricing";
import type { ReplyDoneInfo } from "../engine";
import { isBillableProvider } from "../providers/types";
import { QuotaExceededError, QuotaManager } from "../quota";
import { LiveOptionsMessenger, OPTIONS_MODEL, ScriptedOptionsMessenger, type OptionsMessenger } from "./messenger";

export interface OptionsServiceOptions {
  db: Db;
  replayMode: boolean;
  live?: () => OptionsMessenger;
  now?: () => number;
}

/** The fork-options side effect: runs after a reply, spends under the cap, and never touches the reply. */
export class OptionsService {
  private db: Db;
  private replayMode: boolean;
  private makeLive: () => OptionsMessenger;
  private live: OptionsMessenger | null = null;
  private now: () => number;
  private inflight = new Map<string, Promise<ForkOption[] | null>>();

  constructor(options: OptionsServiceOptions) {
    this.db = options.db;
    this.replayMode = options.replayMode;
    this.makeLive = options.live ?? (() => new LiveOptionsMessenger());
    this.now = options.now ?? Date.now;
  }

  private messenger(scenario: string | null, billable: boolean): OptionsMessenger {
    if (scenario || !billable || this.replayMode) return new ScriptedOptionsMessenger(scenario);
    this.live ??= this.makeLive();
    return this.live;
  }

  /** Engine `afterDone`: detached; a failure is logged and leaves the reply without options. */
  onReplyDone(info: ReplyDoneInfo): void {
    const pending = this.detect(info).catch((err: unknown) => {
      console.error(`[options] detect failed for ${info.messageId}`, err);
      return null;
    });
    this.inflight.set(info.messageId, pending);
    void pending.finally(() => this.inflight.delete(info.messageId));
  }

  private async detect(info: ReplyDoneInfo): Promise<ForkOption[] | null> {
    const chat = this.db.select({ forkedFrom: chats.forkedFrom }).from(chats).where(eq(chats.id, info.chatId)).get();
    if (!chat || chat.forkedFrom || !info.text.trim() || this.atCap(info.userId)) return null;
    const messenger = this.messenger(info.scenario, info.billable);
    const result = await messenger.detect(info.text);
    this.record(info.userId, info.generationId, "options", result.usage, messenger.name === "haiku");
    this.db.update(messages).set({ forkOptions: result.options }).where(eq(messages.id, info.messageId)).run();
    return result.options;
  }

  /** The stored list, else the one being computed (up to `waitMs`), else null when nothing ran. */
  async awaitOptions(messageId: string, waitMs: number): Promise<ForkOption[] | null> {
    const row = this.db.select({ options: messages.forkOptions }).from(messages).where(eq(messages.id, messageId)).get();
    if (row?.options) return row.options;
    const pending = this.inflight.get(messageId);
    if (!pending) return null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), waitMs);
    });
    try {
      return await Promise.race([pending, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** The sheet's "apply to all": rewritten through the same messenger the reply would use. */
  async rewrite(userId: string, messageId: string, options: readonly ForkOption[], instruction: string): Promise<ForkOption[]> {
    const gen = this.db
      .select({ id: generations.id, scenario: generations.scenario, provider: generations.provider })
      .from(messages)
      .innerJoin(generations, eq(generations.id, messages.generationId))
      .where(eq(messages.id, messageId))
      .get();
    const messenger = this.messenger(gen?.scenario ?? null, gen ? isBillableProvider(gen.provider) : true);
    if (messenger.name === "haiku") {
      const user = this.capRow(userId);
      if (user && user.cap !== null && user.spent >= user.cap) throw new QuotaExceededError(user.spent, user.cap);
    }
    const result = await messenger.rewrite(options, instruction);
    this.record(userId, gen?.id ?? null, "options_rewrite", result.usage, messenger.name === "haiku");
    return result.options;
  }

  private capRow(userId: string): { cap: number | null; spent: number } | undefined {
    return this.db.select({ cap: users.costCapUsd, spent: users.costSpentUsd }).from(users).where(eq(users.id, userId)).get();
  }

  private atCap(userId: string): boolean {
    const user = this.capRow(userId);
    return user !== undefined && user.cap !== null && user.spent >= user.cap;
  }

  private record(userId: string, generationId: string | null, iterationType: string, usage: TokenCounts | null, billable: boolean): void {
    if (!usage) return;
    const costUsd = billable ? costOf(OPTIONS_MODEL, usage) : 0;
    const now = new Date(this.now());
    // The chat may have been deleted while Haiku answered: the spend is kept, the link is not.
    const linked = generationId && this.db.select({ id: generations.id }).from(generations).where(eq(generations.id, generationId)).get() ? generationId : null;
    this.db.transaction((tx) => {
      tx.insert(usageEvents)
        .values({ id: uuidv7(), generationId: linked, userId, model: OPTIONS_MODEL, iterationType, ...usage, costUsd, estimated: false, createdAt: now })
        .run();
      QuotaManager.addSpend(tx as unknown as Db, userId, costUsd);
    });
  }
}
