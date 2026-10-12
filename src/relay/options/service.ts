import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@db/client";
import { chats, generations, messages, usageEvents, users } from "@db/schema";
import { MAX_FORKS, type ForkOption, type OptionsTrace } from "@shared/forks";
import { uuidv7 } from "@shared/id";
import { costOf, type TokenCounts } from "../anthropic/pricing";
import type { ReplyDoneInfo } from "../engine";
import { isBillableProvider } from "../providers/types";
import { QuotaExceededError, QuotaManager } from "../quota";
import { LiveOptionsMessenger, OPTIONS_MODEL, ScriptedOptionsMessenger, type DetectProgress, type OptionsMessenger } from "./messenger";

/** A reply's detection as it runs: the count once known, the options complete so far, then done or failed. */
export interface OptionsProgress {
  count: number | null;
  options: ForkOption[];
  done: boolean;
  failed: boolean;
}

type Tracked = OptionsProgress & { listeners: Set<() => void> };

export interface OptionsServiceOptions {
  db: Db;
  replayMode: boolean;
  quota?: QuotaManager;
  live?: () => OptionsMessenger;
  now?: () => number;
}

/** The fork-options side effect: runs after a reply, spends under the cap, and never touches the reply. */
export class OptionsService {
  private db: Db;
  private replayMode: boolean;
  private quota: QuotaManager;
  private makeLive: () => OptionsMessenger;
  private live: OptionsMessenger | null = null;
  private now: () => number;
  private inflight = new Map<string, Promise<ForkOption[] | null>>();
  private traces = new Map<string, OptionsTrace>();
  private progress = new Map<string, Tracked>();

  constructor(options: OptionsServiceOptions) {
    this.db = options.db;
    this.replayMode = options.replayMode;
    this.quota = options.quota ?? new QuotaManager(options.db);
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
    const tracked: Tracked = { count: null, options: [], done: false, failed: false, listeners: new Set() };
    this.progress.set(info.messageId, tracked);
    const notify = () => {
      for (const listener of tracked.listeners) listener();
    };
    const pending = this.detect(info, (p) => {
      if (p.count !== undefined) tracked.count = p.count;
      if (p.options) tracked.options = p.options;
      notify();
    }).catch((err: unknown) => {
      console.error(`[options] detect failed for ${info.messageId}`, err);
      tracked.failed = true;
      return null;
    });
    this.inflight.set(info.messageId, pending);
    void pending.then((options) => {
      this.inflight.delete(info.messageId);
      if (!tracked.failed) tracked.options = options ?? [];
      tracked.done = true;
      notify();
      // Readers within a minute get the outcome from here; later ones from the row.
      const timer = setTimeout(() => {
        if (this.progress.get(info.messageId) === tracked) this.progress.delete(info.messageId);
      }, 60_000);
      timer.unref?.();
    });
  }

  /** Follows a reply's detection while it runs, and for a minute after; null when none is known here. */
  watch(messageId: string, listener: (state: OptionsProgress) => void): { state: OptionsProgress; stop: () => void } | null {
    const tracked = this.progress.get(messageId);
    if (!tracked) return null;
    const onChange = () => listener(tracked);
    tracked.listeners.add(onChange);
    return { state: tracked, stop: () => void tracked.listeners.delete(onChange) };
  }

  private async detect(info: ReplyDoneInfo, onProgress: (progress: DetectProgress) => void): Promise<ForkOption[] | null> {
    const chat = this.db.select({ forkedFrom: chats.forkedFrom }).from(chats).where(eq(chats.id, info.chatId)).get();
    const startedAt = performance.now();
    if (!chat || chat.forkedFrom || !info.text.trim() || !this.exploreOn(info.userId) || this.atCap(info.userId) || !this.canFork(info.chatId)) return null;
    const messenger = this.messenger(info.scenario, info.billable);
    const result = await messenger.detect(info.text, onProgress);
    this.record(info.userId, info.generationId, "options", result.usage, messenger.name === "haiku");
    // A fork made before detection finished spent the options ([]); they stay spent.
    this.db.update(messages).set({ forkOptions: result.options }).where(and(eq(messages.id, info.messageId), isNull(messages.forkOptions))).run();
    if (result.trace) this.keepTrace(info.messageId, { ...result.trace, totalMs: Math.round(performance.now() - startedAt) });
    return result.options;
  }

  /** A chat that just stopped being a fork: its last reply was skipped then, so it is read now. Returns that reply's id; null with Explore off. */
  detectLastReply(chatId: string, userId: string): string | null {
    if (!this.exploreOn(userId)) return null;
    const row = this.db
      .select({ id: messages.id, content: messages.content, status: messages.status, options: messages.forkOptions, generationId: messages.generationId })
      .from(messages)
      .where(eq(messages.chatId, chatId))
      .orderBy(desc(messages.position))
      .all()
      .find((m) => m.status === "done" || m.status === "refused");
    if (!row || row.status !== "done") return null;
    if (row.options !== null) return row.id;
    const gen = row.generationId
      ? this.db.select({ scenario: generations.scenario, provider: generations.provider }).from(generations).where(eq(generations.id, row.generationId)).get()
      : undefined;
    this.onReplyDone({
      chatId,
      messageId: row.id,
      generationId: row.generationId ?? "",
      userId,
      scenario: gen?.scenario ?? null,
      billable: gen ? isBillableProvider(gen.provider) : true,
      text: row.content.filter((b) => b.type === "text").map((b) => b.text).join(""),
    });
    return row.id;
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
  async rewrite(userId: string, messageId: string, options: readonly ForkOption[], instruction: string): Promise<{ options: ForkOption[]; trace: OptionsTrace | null }> {
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
    return { options: result.options, trace: result.trace ?? null };
  }

  /** The detection trace for a reply, handed out once. */
  takeTrace(messageId: string): OptionsTrace | null {
    const trace = this.traces.get(messageId) ?? null;
    this.traces.delete(messageId);
    return trace;
  }

  private keepTrace(messageId: string, trace: OptionsTrace): void {
    this.traces.set(messageId, trace);
    if (this.traces.size > 50) this.traces.delete(this.traces.keys().next().value!);
  }

  private capRow(userId: string): { cap: number | null; spent: number } | undefined {
    return this.db.select({ cap: users.costCapUsd, spent: users.costSpentUsd }).from(users).where(eq(users.id, userId)).get();
  }

  /** A chat with its full share of forks can't be forked again, so there is nothing to detect. */
  private canFork(chatId: string): boolean {
    return this.db.select({ id: chats.id }).from(chats).where(eq(chats.forkedFrom, chatId)).all().length < MAX_FORKS;
  }

  /** Explore options turned off in Settings: no Haiku call, so no spend. */
  private exploreOn(userId: string): boolean {
    return this.db.select({ on: users.exploreOptions }).from(users).where(eq(users.id, userId)).get()?.on ?? true;
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
      this.quota.spend(tx, userId, costUsd);
    });
  }
}
