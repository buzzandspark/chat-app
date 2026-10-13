import type { ClientBlock, StoredContentBlock } from "@shared/blocks";
import { toClientBlocks } from "@shared/blocks";
import type { ForkOption } from "@shared/forks";
import { DEFAULT_MODEL, isModelId, type ModelId } from "@shared/models";
import type {
  InterruptedReason,
  MessageStatus,
  RefusalInfo,
  RelayError,
  ThinkingOptions,
  Timings,
  UsageSummary,
} from "@shared/types";
import { isControl, type MessageSnapshot, type RelayEvent } from "@relay/events";

export type ConnectionState = "idle" | "streaming" | "reconnecting" | "offline";

export interface MessageState {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  blocks: ClientBlock[];
  status: MessageStatus;
  requestedModel: string | null;
  servingModel: string | null;
  stopReason: string | null;
  refusal: RefusalInfo | null;
  error: RelayError | null;
  timings: Timings | null;
  usage: UsageSummary | null;
  generationId: string | null;
  interruptedReason: InterruptedReason | null;
  /** Painted partial text on a no-fallback refusal is dimmed and not saved. */
  discardedText: boolean;
  connection: ConnectionState;
  reconnectAttempt: number;
  /** Client-clock timestamps for the thinking duration label. */
  thinkingStartedAt: number | null;
  thinkingEndedAt: number | null;
  /** The last producer seq applied; control events never move it. */
  lastSeq: number;
  createdAt: number;
  /** Added by this client and not yet listed by the server (a POST in flight, or one it refused). */
  local: boolean;
  /** Retries already made for this user message in the current rate-limited streak. */
  retryAttempt: number;
  /** The scripted scenario this reply comes from, so Continue and retries keep it. */
  scenario: string | null;
  /** Null until the server has listed the message. */
  position: number | null;
  /** Fork prompts for a reply: null = not run or unknown, [] = none. */
  options: ForkOption[] | null;
  optionsStream: OptionsStream | null;
}

interface OptionsStream {
  count: number | null;
  partial: ForkOption[];
  failed: boolean;
}

/** Kept in the store so a remount or an Activity eviction never resets them (ADR-0005). */
export interface ChatSettings {
  model: ModelId;
  thinking: ThinkingOptions;
  /** Carries its label so the composer chip needs no catalogue. */
  scenario: { name: string; title: string } | null;
}

const DEFAULT_SETTINGS: ChatSettings = { model: DEFAULT_MODEL, thinking: { harder: false }, scenario: null };

export interface ChatState {
  id: string;
  messageIds: string[];
  title: string | null;
  /** Server rows applied (or created locally), so an empty list means a new chat. */
  seeded: boolean;
  settings: ChatSettings;
  /** True once the user changed a setting here; a seed then leaves the model alone. */
  settingsTouched: boolean;
  /** Messages before the window the server sent; 0 once everything is loaded. */
  older: number;
  queue: QueuedMessage[];
  /** Set on a fork: the chat its rows were copied from, and the position of its first own message. */
  forkedFrom: string | null;
  forkPosition: number | null;
}

/** A message row as the page and `GET /api/chats/:id` deliver it. */
export interface SeedRow {
  id: string;
  chatId: string;
  role: "user" | "assistant";
  content: StoredContentBlock[];
  status: MessageStatus;
  requestedModel: string | null;
  servingModel: string | null;
  stopReason: string | null;
  refusal: RefusalInfo | null;
  error: RelayError | null;
  timings: Timings | null;
  generationId: string | null;
  lastSeq?: number | null;
  scenario?: string | null;
  position?: number;
  thinking?: ThinkingOptions | null;
  options?: ForkOption[] | null;
  createdAt: number;
}

interface Internal {
  /** Stream block index to position in `blocks`. */
  blockIndex: Map<number, number>;
}

type Listener = () => void;

export interface QueuedMessage {
  id: string;
  text: string;
  scenario: string | null;
}

function emptyChat(id: string, settings: ChatSettings = DEFAULT_SETTINGS): ChatState {
  return { id, messageIds: [], title: null, seeded: false, settings, settingsTouched: false, older: 0, queue: [], forkedFrom: null, forkPosition: null };
}

const EMPTY_CHAT: ChatState = emptyChat("");

const TERMINAL: ReadonlySet<MessageStatus> = new Set(["done", "stopped", "interrupted", "error", "refused"]);

export function createMessageState(partial: Partial<MessageState> & Pick<MessageState, "id" | "chatId" | "role">): MessageState {
  return {
    blocks: [],
    status: "done",
    requestedModel: null,
    servingModel: null,
    stopReason: null,
    refusal: null,
    error: null,
    timings: null,
    usage: null,
    generationId: null,
    interruptedReason: null,
    discardedText: false,
    connection: "idle",
    reconnectAttempt: 0,
    thinkingStartedAt: null,
    thinkingEndedAt: null,
    lastSeq: -1,
    createdAt: Date.now(),
    local: false,
    retryAttempt: 0,
    scenario: null,
    position: null,
    options: null,
    optionsStream: null,
    ...partial,
  };
}

/** Maps stream block indexes to the positions `toClientBlocks` renders, where a fallback before any text has none. */
function blockIndexFromContent(content: readonly StoredContentBlock[]): Map<number, number> {
  const map = new Map<number, number>();
  let pos = 0;
  let hasText = false;
  content.forEach((b, i) => {
    if (b.type === "text" || b.type === "thinking" || b.type === "redacted_thinking" || (b.type === "fallback" && hasText)) map.set(i, pos++);
    if (b.type === "text" && b.text.length > 0) hasText = true;
  });
  return map;
}

export function textOf(blocks: readonly ClientBlock[]): string {
  let s = "";
  for (const b of blocks) if (b.type === "text") s += b.text;
  return s;
}

/**
 * Only while it is the chat's last message: a refused reply never reached the server, so its `replaceFrom`
 * would match nothing there and later turns would diverge between client and server.
 */
export function canRetryReply(chat: Pick<ChatState, "messageIds">, message: Pick<MessageState, "id" | "status">): boolean {
  return message.status !== "error" || chat.messageIds.at(-1) === message.id;
}

/** Per-message subscribers; producer events batch per frame, dedupe by seq; control events always apply. */
export class ChatStore {
  /** Model and effort for chats with no reply to inherit from: the user's last choice, set by the shell. */
  private defaults: ChatSettings = DEFAULT_SETTINGS;
  /** Whether the shell has read that choice yet; until then an empty chat's model is not known. */
  private defaultsLoaded = false;

  /** A chat's model and effort are known: from its last reply, or for an empty chat from the user's last choice. */
  settingsKnown(chatId: string): boolean {
    const chat = this.getChat(chatId);
    return chat.seeded && (chat.messageIds.length > 0 || this.defaultsLoaded);
  }

  setDefaultSettings(patch: Partial<Pick<ChatSettings, "model" | "thinking">>): void {
    this.defaults = { ...this.defaults, ...patch };
    this.defaultsLoaded = true;
    // Empty chats the user has not touched follow the new default.
    for (const [id, chat] of this.chats) {
      if (chat.settingsTouched || chat.messageIds.length > 0) continue;
      this.chats.set(id, { ...chat, settings: { ...chat.settings, ...patch } });
      this.notifyChat(id);
    }
  }

  private emptyChat(id: string): ChatState {
    return emptyChat(id, this.defaults);
  }

  private messages = new Map<string, MessageState>();
  private internals = new Map<string, Internal>();
  private chats = new Map<string, ChatState>();
  private byGeneration = new Map<string, string>();
  private messageListeners = new Map<string, Set<Listener>>();
  private chatListeners = new Map<string, Set<Listener>>();
  private queue: RelayEvent[] = [];
  private flushHandle: number | null = null;
  private replyEndListeners = new Set<(message: MessageState) => void>();
  /** Kept here for the reply-end watcher; ShellUserProvider keeps it current. */
  exploreOptions = true;
  setExploreOptions(on: boolean): void {
    this.exploreOptions = on;
  }
  private schedule: (cb: () => void) => number;
  private cancel: (handle: number) => void;
  private now: () => number;

  constructor(options: { schedule?: (cb: () => void) => number; cancel?: (handle: number) => void; now?: () => number } = {}) {
    const hasRaf = typeof requestAnimationFrame === "function";
    this.schedule =
      options.schedule ??
      (hasRaf ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 16) as unknown as number);
    this.cancel = options.cancel ?? (hasRaf ? (h) => cancelAnimationFrame(h) : (h) => clearTimeout(h));
    this.now = options.now ?? Date.now;
  }

  getMessage(id: string): MessageState | undefined {
    return this.messages.get(id);
  }

  getChat(id: string): ChatState {
    return this.chats.get(id) ?? EMPTY_CHAT;
  }

  messageIdForGeneration(generationId: string): string | undefined {
    return this.byGeneration.get(generationId);
  }

  /** Messages whose generation may still be in flight (for reconnect sweeps). */
  pendingMessages(): MessageState[] {
    const out: MessageState[] = [];
    for (const m of this.messages.values()) {
      if (m.role === "assistant" && m.status === "streaming" && m.generationId) out.push(m);
    }
    return out;
  }

  subscribeMessage(id: string, listener: Listener): () => void {
    let set = this.messageListeners.get(id);
    if (!set) {
      set = new Set();
      this.messageListeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.messageListeners.delete(id);
    };
  }

  subscribeChat(id: string, listener: Listener): () => void {
    let set = this.chatListeners.get(id);
    if (!set) {
      set = new Set();
      this.chatListeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.chatListeners.delete(id);
    };
  }

  private notifyMessage(id: string): void {
    const set = this.messageListeners.get(id);
    if (set) for (const l of set) l();
  }

  private notifyChat(id: string): void {
    const set = this.chatListeners.get(id);
    if (set) for (const l of set) l();
  }

  /** A chat created on this client: known to be empty, no server round trip needed to say so. */
  createChat(chatId: string): void {
    const previous = this.chats.get(chatId);
    if (previous?.seeded) return;
    this.chats.set(chatId, { ...(previous ?? this.emptyChat(chatId)), seeded: true });
    this.notifyChat(chatId);
  }

  setSettings(chatId: string, patch: Partial<ChatSettings>): void {
    const chat = this.chats.get(chatId) ?? this.emptyChat(chatId);
    this.chats.set(chatId, { ...chat, settings: { ...chat.settings, ...patch }, settingsTouched: true });
    this.notifyChat(chatId);
  }

  /**
   * Local in-flight messages win and unlisted optimistic ones stay after the server's rows (ADR-0005).
   * deferNotify: the caller seeds during its own render, so subscribers are notified in a microtask.
   */
  seedChat(
    chatId: string,
    title: string | null,
    rows: readonly SeedRow[],
    options: { deferNotify?: boolean; older?: number; fork?: { from: string | null; position: number | null } } = {},
  ): void {
    const previous = this.chats.get(chatId);
    const ids: string[] = [];
    const touched: string[] = [];
    const listed = new Set<string>();
    for (const row of rows) {
      listed.add(row.id);
      ids.push(row.id);
      const existing = this.messages.get(row.id);
      if (existing) {
        if (existing.status === "streaming") continue;
        if (TERMINAL.has(existing.status) && row.status === "streaming") continue;
        if (sameRow(existing, row)) continue;
      }
      const m = messageStateFromRow(row);
      this.messages.set(row.id, m);
      this.internals.set(row.id, { blockIndex: blockIndexFromContent(row.content) });
      if (m.generationId) this.byGeneration.set(m.generationId, row.id);
      touched.push(row.id);
    }
    if (previous) {
      for (const id of previous.messageIds) {
        if (!listed.has(id) && this.messages.get(id)?.local) ids.push(id);
      }
    }
    const nextTitle = title ?? previous?.title ?? null;
    // An existing chat opens on the model and effort its last reply was asked with, unless the user already chose here.
    let settings = previous?.settings ?? this.defaults;
    if (!previous?.settingsTouched) {
      for (let i = rows.length - 1; i >= 0; i--) {
        const row = rows[i]!;
        if (row.role === "assistant" && isModelId(row.requestedModel)) {
          const thinking = row.thinking ?? settings.thinking;
          if (settings.model !== row.requestedModel || thinking.harder !== settings.thinking.harder) {
            settings = { ...settings, model: row.requestedModel, thinking };
          }
          break;
        }
      }
    }
    const older = options.older ?? 0;
    const forkedFrom = options.fork ? options.fork.from : (previous?.forkedFrom ?? null);
    const forkPosition = options.fork ? options.fork.position : (previous?.forkPosition ?? null);
    const same =
      previous !== undefined &&
      previous.seeded &&
      previous.title === nextTitle &&
      previous.settings === settings &&
      previous.older === older &&
      previous.forkedFrom === forkedFrom &&
      previous.forkPosition === forkPosition &&
      previous.messageIds.length === ids.length &&
      previous.messageIds.every((id, i) => id === ids[i]);
    if (!same) {
      this.chats.set(chatId, { ...(previous ?? this.emptyChat(chatId)), messageIds: ids, title: nextTitle, seeded: true, settings, older, forkedFrom, forkPosition });
    }
    const notify = () => {
      for (const id of touched) this.notifyMessage(id);
      if (!same) this.notifyChat(chatId);
    };
    if (touched.length === 0 && same) return;
    if (options.deferNotify) queueMicrotask(notify);
    else notify();
  }

  addMessage(message: MessageState): void {
    this.messages.set(message.id, { ...message, local: true });
    this.internals.set(message.id, { blockIndex: new Map() });
    if (message.generationId) this.byGeneration.set(message.generationId, message.id);
    const chat = this.chats.get(message.chatId) ?? this.emptyChat(message.chatId);
    if (!chat.messageIds.includes(message.id)) {
      this.chats.set(message.chatId, { ...chat, messageIds: [...chat.messageIds, message.id] });
      this.notifyChat(message.chatId);
    }
    this.notifyMessage(message.id);
  }

  /** Remove this message and everything after it in its chat. */
  truncateFrom(id: string): void {
    const m = this.messages.get(id);
    if (!m) return;
    const chat = this.chats.get(m.chatId);
    if (!chat) return;
    const index = chat.messageIds.indexOf(id);
    if (index === -1) return;
    for (const victim of chat.messageIds.slice(index)) {
      const v = this.messages.get(victim);
      this.messages.delete(victim);
      this.internals.delete(victim);
      if (v?.generationId) this.byGeneration.delete(v.generationId);
      this.notifyMessage(victim);
    }
    this.chats.set(m.chatId, { ...chat, messageIds: chat.messageIds.slice(0, index) });
    this.notifyChat(m.chatId);
  }

  /**
   * Drops the rows of the given chats; a view that still shows one re-seeds from its own rows.
   * Returns the chats it skipped because a reply is still streaming.
   */
  evictChats(ids: Iterable<string>): string[] {
    const streaming: string[] = [];
    for (const id of ids) {
      const chat = this.chats.get(id);
      if (!chat || !chat.seeded || chat.messageIds.length === 0) continue;
      if (chat.messageIds.some((mid) => this.messages.get(mid)?.status === "streaming")) {
        streaming.push(id);
        continue;
      }
      for (const mid of chat.messageIds) {
        const m = this.messages.get(mid);
        this.messages.delete(mid);
        this.internals.delete(mid);
        if (m?.generationId) this.byGeneration.delete(m.generationId);
      }
      this.chats.set(id, { ...chat, messageIds: [], seeded: false });
      this.notifyChat(id);
    }
    return streaming;
  }

  /** The chat was deleted: drop its messages and leave a seeded, empty chat so the view shows the empty state. */
  removeChat(chatId: string): void {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    for (const id of chat.messageIds) {
      const m = this.messages.get(id);
      this.messages.delete(id);
      this.internals.delete(id);
      if (m?.generationId) this.byGeneration.delete(m.generationId);
      this.notifyMessage(id);
    }
    this.chats.set(chatId, { ...this.emptyChat(chatId), seeded: true });
    this.notifyChat(chatId);
  }

  /** The generation client sends the first queued message when the streaming reply ends. */
  enqueueMessage(chatId: string, item: QueuedMessage): void {
    const chat = this.chats.get(chatId) ?? this.emptyChat(chatId);
    this.chats.set(chatId, { ...chat, queue: [...chat.queue, item] });
    this.notifyChat(chatId);
  }

  takeQueued(chatId: string): QueuedMessage | undefined {
    const chat = this.chats.get(chatId);
    const [first, ...rest] = chat?.queue ?? [];
    if (!chat || !first) return undefined;
    this.chats.set(chatId, { ...chat, queue: rest });
    this.notifyChat(chatId);
    return first;
  }

  removeQueued(chatId: string, id: string): QueuedMessage | undefined {
    const chat = this.chats.get(chatId);
    const item = chat?.queue.find((q) => q.id === id);
    if (!chat || !item) return undefined;
    this.chats.set(chatId, { ...chat, queue: chat.queue.filter((q) => q.id !== id) });
    this.notifyChat(chatId);
    return item;
  }

  /** A fork promoted to main, or a main turned fork: the divider follows. */
  setFork(chatId: string, fork: { from: string | null; position: number | null }): void {
    const chat = this.chats.get(chatId);
    if (!chat || (chat.forkedFrom === fork.from && chat.forkPosition === fork.position)) return;
    this.chats.set(chatId, { ...chat, forkedFrom: fork.from, forkPosition: fork.position });
    this.notifyChat(chatId);
  }

  setChatTitle(chatId: string, title: string | null): void {
    const chat = this.chats.get(chatId) ?? this.emptyChat(chatId);
    if (chat.title === title) return;
    this.chats.set(chatId, { ...chat, title });
    this.notifyChat(chatId);
  }

  updateMessage(id: string, patch: Partial<MessageState> | ((m: MessageState) => Partial<MessageState>)): void {
    const m = this.messages.get(id);
    if (!m) return;
    const next = { ...m, ...(typeof patch === "function" ? patch(m) : patch) };
    this.messages.set(id, next);
    if (next.generationId && next.generationId !== m.generationId) this.byGeneration.set(next.generationId, id);
    this.notifyMessage(id);
  }

  setConnection(id: string, connection: ConnectionState, reconnectAttempt = 0): void {
    const m = this.messages.get(id);
    if (!m || (m.connection === connection && m.reconnectAttempt === reconnectAttempt)) return;
    this.updateMessage(id, { connection, reconnectAttempt });
  }

  markClientTiming(id: string, key: keyof NonNullable<Timings["client"]>, at: number = this.now()): void {
    const m = this.messages.get(id);
    if (!m) return;
    // Only a reply sent from this client has client stamps; a saved or resumed reply gets none.
    if (!m.timings?.client) return;
    const client = { ...m.timings.client };
    if (client[key] !== undefined) return;
    client[key] = at;
    this.updateMessage(id, { timings: { ...(m.timings ?? {}), client } });
  }

  /** The first text paints in the render this commit notifies; stamped in a task after the next frame. */
  private markFirstPaint(id: string): void {
    if (typeof requestAnimationFrame !== "function") return;
    requestAnimationFrame(() => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => this.markClientTiming(id, "firstPaint");
      channel.port2.postMessage(0);
    });
  }

  /** Called after an applied event has taken a reply out of `streaming` (a terminal event or a final snapshot). */
  onReplyEnd(listener: (message: MessageState) => void): () => void {
    this.replyEndListeners.add(listener);
    return () => {
      this.replyEndListeners.delete(listener);
    };
  }

  private commit(ids: Iterable<string>, drafts: Map<string, MessageState>): void {
    const ended: MessageState[] = [];
    for (const id of ids) {
      const draft = drafts.get(id);
      if (draft) {
        const previous = this.messages.get(id);
        if (previous?.status === "streaming" && draft.status !== "streaming") ended.push(draft);
        if (draft.timings?.client?.sent !== undefined && previous && !textOf(previous.blocks) && textOf(draft.blocks)) this.markFirstPaint(id);
        this.messages.set(id, draft);
      }
      this.notifyMessage(id);
    }
    for (const message of ended) for (const listener of this.replyEndListeners) listener(message);
  }

  /** Queue a producer event for the next frame; control events apply immediately. */
  enqueue(event: RelayEvent): void {
    if (isControl(event)) {
      this.flush();
      this.apply(event);
      return;
    }
    this.queue.push(event);
    if (this.flushHandle === null) this.flushHandle = this.schedule(() => this.flush());
  }

  flush(): void {
    if (this.flushHandle !== null) {
      this.cancel(this.flushHandle);
      this.flushHandle = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    const touched = new Set<string>();
    const drafts = new Map<string, MessageState>();
    for (const event of batch) {
      const id = this.applyToDraft(event, drafts);
      if (id) touched.add(id);
    }
    this.commit(touched, drafts);
  }

  apply(event: RelayEvent): void {
    const drafts = new Map<string, MessageState>();
    const id = this.applyToDraft(event, drafts);
    if (id) this.commit([id], drafts);
  }

  private draftFor(id: string, drafts: Map<string, MessageState>): MessageState | undefined {
    let d = drafts.get(id);
    if (d) return d;
    const m = this.messages.get(id);
    if (!m) return undefined;
    d = { ...m, blocks: [...m.blocks] };
    drafts.set(id, d);
    return d;
  }

  private applyToDraft(event: RelayEvent, drafts: Map<string, MessageState>): string | null {
    const id =
      this.byGeneration.get(event.generationId) ??
      (event.type === "started" ? event.messageId : event.type === "snapshot" ? event.message.id : undefined);
    if (!id) return null;
    if (event.type === "started" && !this.byGeneration.has(event.generationId)) {
      this.byGeneration.set(event.generationId, id);
    }
    const d = this.draftFor(id, drafts);
    if (!d) return null;
    const internal = this.internals.get(id) ?? { blockIndex: new Map() };
    this.internals.set(id, internal);

    if (event.seq !== null) {
      if (event.seq <= d.lastSeq) return null; // duplicate or out of order: already applied
      d.lastSeq = event.seq;
    }

    switch (event.type) {
      case "started":
        d.generationId = event.generationId;
        d.requestedModel = event.requestedModel;
        if (event.scenario !== undefined) d.scenario = event.scenario;
        if (d.status !== "streaming") d.status = "streaming";
        break;
      case "message_start":
        d.servingModel = event.model;
        break;
      case "block_start": {
        if (event.block === "tool_use") break;
        const block: ClientBlock =
          event.block === "text"
            ? { type: "text", text: "" }
            : { type: "thinking", text: "", redacted: event.block === "redacted_thinking" };
        internal.blockIndex.set(event.index, d.blocks.length);
        d.blocks.push(block);
        if (block.type === "thinking" && d.thinkingStartedAt === null) d.thinkingStartedAt = this.now();
        break;
      }
      case "text_delta":
      case "thinking_delta": {
        let pos = internal.blockIndex.get(event.index);
        if (pos === undefined) {
          // The block started before the seq this client caught up from (an empty block is not saved): create it now.
          pos = d.blocks.length;
          internal.blockIndex.set(event.index, pos);
          d.blocks.push(event.type === "text_delta" ? { type: "text", text: "" } : { type: "thinking", text: "" });
          if (event.type === "thinking_delta" && d.thinkingStartedAt === null) d.thinkingStartedAt = this.now();
        }
        const block = d.blocks[pos];
        if (!block || block.type === "divider") break;
        d.blocks[pos] = { ...block, text: block.text + event.text };
        break;
      }
      case "block_stop": {
        const pos = internal.blockIndex.get(event.index);
        const block = pos === undefined ? undefined : d.blocks[pos];
        if (block?.type === "thinking" && d.thinkingEndedAt === null) d.thinkingEndedAt = this.now();
        break;
      }
      case "fallback_boundary":
        d.servingModel = event.to;
        if (event.visible) d.blocks.push({ type: "divider", from: event.from, to: event.to, category: event.category });
        break;
      case "refusal":
        d.refusal = { category: event.category, explanation: event.explanation };
        if (event.hadText) d.discardedText = true;
        break;
      case "done":
        d.status = event.stopReason === "refusal" ? "refused" : "done";
        d.stopReason = event.stopReason;
        d.servingModel = event.servingModel;
        d.usage = event.usage;
        d.timings = { ...(d.timings ?? {}), server: event.timings };
        d.connection = "idle";
        if (d.thinkingStartedAt !== null && d.thinkingEndedAt === null) d.thinkingEndedAt = this.now();
        break;
      case "stopped":
        d.status = "stopped";
        d.servingModel = event.servingModel ?? d.servingModel;
        d.usage = event.usage;
        d.connection = "idle";
        if (d.thinkingStartedAt !== null && d.thinkingEndedAt === null) d.thinkingEndedAt = this.now();
        break;
      case "interrupted":
        d.status = "interrupted";
        d.interruptedReason = event.reason;
        d.connection = "idle";
        if (d.thinkingStartedAt !== null && d.thinkingEndedAt === null) d.thinkingEndedAt = this.now();
        break;
      case "error":
        d.status = "error";
        if (d.thinkingStartedAt !== null && d.thinkingEndedAt === null) d.thinkingEndedAt = this.now();
        d.error = event.error;
        d.connection = "idle";
        break;
      case "snapshot":
        this.applySnapshot(d, event.message, event.status, internal);
        break;
    }
    return id;
  }

  /**
   * A final row replaces local state; otherwise the side covering more of the stream wins (by seq, else text
   * length for older rows). Moving the cursor past the covered seq makes a late replay dedupe instead of append.
   */
  private applySnapshot(d: MessageState, snapshot: MessageSnapshot, status: MessageStatus, internal: Internal): void {
    const serverBlocks = toClientBlocks(snapshot.content as StoredContentBlock[]);
    const covered = snapshot.lastSeq ?? null;
    const final = status === "done" || status === "refused";
    const serverAhead = covered !== null ? covered > d.lastSeq : textOf(serverBlocks).length > textOf(d.blocks).length;
    if (final || serverAhead) {
      d.blocks = serverBlocks;
      internal.blockIndex.clear();
      for (const [index, pos] of blockIndexFromContent(snapshot.content as StoredContentBlock[])) internal.blockIndex.set(index, pos);
      if (covered !== null && covered > d.lastSeq) d.lastSeq = covered;
    }
    d.status = status;
    d.requestedModel = snapshot.requestedModel ?? d.requestedModel;
    d.servingModel = snapshot.servingModel ?? d.servingModel;
    d.stopReason = snapshot.stopReason;
    d.refusal = snapshot.refusal;
    d.error = snapshot.error;
    d.generationId = snapshot.generationId ?? d.generationId;
    if (snapshot.timings?.server) d.timings = { ...(d.timings ?? {}), server: snapshot.timings.server };
    if (status === "refused") d.discardedText = textOf(d.blocks).length > 0;
    d.connection = "idle";
    if (d.thinkingStartedAt !== null && d.thinkingEndedAt === null) d.thinkingEndedAt = this.now();
  }
}

/** True when a saved row carries nothing the store does not already show, so the row object can stay. */
function sameRow(existing: MessageState, row: SeedRow): boolean {
  if (existing.local || existing.status !== row.status || existing.stopReason !== row.stopReason) return false;
  if (existing.lastSeq !== (row.lastSeq ?? -1)) return false;
  if (JSON.stringify(existing.options) !== JSON.stringify(row.options ?? null)) return false;
  const blocks = toClientBlocks(row.content);
  if (blocks.length !== existing.blocks.length) return false;
  return textOf(blocks) === textOf(existing.blocks);
}

function messageStateFromRow(row: SeedRow): MessageState {
  const blocks = toClientBlocks(row.content);
  return createMessageState({
    id: row.id,
    chatId: row.chatId,
    role: row.role,
    blocks,
    status: row.status,
    requestedModel: row.requestedModel,
    servingModel: row.servingModel,
    stopReason: row.stopReason,
    refusal: row.refusal,
    error: row.error,
    timings: row.timings,
    generationId: row.generationId,
    discardedText: row.status === "refused" && textOf(blocks).length > 0,
    lastSeq: row.lastSeq ?? -1,
    scenario: row.scenario ?? null,
    position: row.position ?? null,
    options: row.options ?? null,
    createdAt: row.createdAt,
  });
}

