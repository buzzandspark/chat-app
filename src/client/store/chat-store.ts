import type { ClientBlock, StoredContentBlock } from "@shared/blocks";
import { toClientBlocks } from "@shared/blocks";
import type {
  InterruptedReason,
  MessageStatus,
  RefusalInfo,
  RelayError,
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
  /** D17: painted partial text on a no-fallback refusal is dimmed and not saved. */
  discardedText: boolean;
  connection: ConnectionState;
  reconnectAttempt: number;
  /** Client-clock timestamps for the thinking duration label (D12). */
  thinkingStartedAt: number | null;
  thinkingEndedAt: number | null;
  /** The last producer seq applied; control events never move it. */
  lastSeq: number;
  createdAt: number;
}

export interface ChatState {
  id: string;
  messageIds: string[];
  title: string | null;
  /** True once the server's rows have been applied (or the chat was created locally), so an empty list means a new chat. */
  seeded: boolean;
}

interface Internal {
  /** Stream block index to position in `blocks`. */
  blockIndex: Map<number, number>;
}

type Listener = () => void;

export const EMPTY_CHAT: ChatState = { id: "", messageIds: [], title: null, seeded: false };

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
    ...partial,
  };
}

export function textOf(blocks: readonly ClientBlock[]): string {
  let s = "";
  for (const b of blocks) if (b.type === "text") s += b.text;
  return s;
}

/** D10: per-message subscribers; producer events batch per frame, dedupe by seq; control events always apply. */
export class ChatStore {
  private messages = new Map<string, MessageState>();
  private internals = new Map<string, Internal>();
  private chats = new Map<string, ChatState>();
  private byGeneration = new Map<string, string>();
  private messageListeners = new Map<string, Set<Listener>>();
  private chatListeners = new Map<string, Set<Listener>>();
  private queue: RelayEvent[] = [];
  private flushHandle: number | null = null;
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

  /** Keeps in-flight messages. deferNotify: the caller seeds during its own render, so notify in a microtask. */
  hydrateChat(chatId: string, title: string | null, incoming: MessageState[], options: { deferNotify?: boolean } = {}): void {
    const ids: string[] = [];
    const touched: string[] = [];
    for (const m of incoming) {
      const existing = this.messages.get(m.id);
      if (existing && existing.status === "streaming") {
        ids.push(m.id);
        continue;
      }
      this.messages.set(m.id, m);
      this.internals.set(m.id, { blockIndex: new Map() });
      if (m.generationId) this.byGeneration.set(m.generationId, m.id);
      ids.push(m.id);
      touched.push(m.id);
    }
    const previous = this.chats.get(chatId);
    const same =
      previous &&
      previous.seeded &&
      previous.title === title &&
      previous.messageIds.length === ids.length &&
      previous.messageIds.every((id, i) => id === ids[i]);
    if (!same) this.chats.set(chatId, { id: chatId, messageIds: ids, title, seeded: true });
    const notify = () => {
      for (const id of touched) this.notifyMessage(id);
      if (!same) this.notifyChat(chatId);
    };
    if (options.deferNotify) queueMicrotask(notify);
    else notify();
  }

  addMessage(message: MessageState): void {
    this.messages.set(message.id, message);
    this.internals.set(message.id, { blockIndex: new Map() });
    if (message.generationId) this.byGeneration.set(message.generationId, message.id);
    const chat = this.chats.get(message.chatId) ?? { id: message.chatId, messageIds: [], title: null, seeded: false };
    if (!chat.messageIds.includes(message.id)) {
      this.chats.set(message.chatId, { ...chat, messageIds: [...chat.messageIds, message.id] });
      this.notifyChat(message.chatId);
    }
    this.notifyMessage(message.id);
  }

  removeMessage(id: string): void {
    const m = this.messages.get(id);
    if (!m) return;
    this.messages.delete(id);
    this.internals.delete(id);
    if (m.generationId) this.byGeneration.delete(m.generationId);
    const chat = this.chats.get(m.chatId);
    if (chat) {
      this.chats.set(m.chatId, { ...chat, messageIds: chat.messageIds.filter((x) => x !== id) });
      this.notifyChat(m.chatId);
    }
    this.notifyMessage(id);
  }

  /** Remove this message and everything after it in its chat (edit-last-message, D10). */
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

  setChatTitle(chatId: string, title: string | null): void {
    const chat = this.chats.get(chatId) ?? { id: chatId, messageIds: [], title: null, seeded: false };
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
    const client = { ...(m.timings?.client ?? { sent: at }) };
    if (client[key] !== undefined) return;
    client[key] = at;
    this.updateMessage(id, { timings: { ...(m.timings ?? {}), client } });
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
    for (const id of touched) {
      const draft = drafts.get(id);
      if (draft) this.messages.set(id, draft);
      this.notifyMessage(id);
    }
  }

  apply(event: RelayEvent): void {
    const drafts = new Map<string, MessageState>();
    const id = this.applyToDraft(event, drafts);
    if (!id) return;
    const draft = drafts.get(id);
    if (draft) this.messages.set(id, draft);
    this.notifyMessage(id);
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
        const pos = internal.blockIndex.get(event.index);
        if (pos === undefined) break;
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
        break;
      case "interrupted":
        d.status = "interrupted";
        d.interruptedReason = event.reason;
        d.connection = "idle";
        break;
      case "error":
        d.status = "error";
        d.error = event.error;
        d.connection = "idle";
        break;
      case "snapshot":
        this.applySnapshot(d, event.message, event.status, internal);
        break;
    }
    return id;
  }

  /** D2: done replaces local state; interrupted/stopped keep longer local text and apply only the status. */
  private applySnapshot(d: MessageState, snapshot: MessageSnapshot, status: MessageStatus, internal: Internal): void {
    const serverBlocks = toClientBlocks(snapshot.content as StoredContentBlock[]);
    const keepLocal =
      (status === "interrupted" || status === "stopped") && textOf(d.blocks).length >= textOf(serverBlocks).length;
    if (!keepLocal) {
      d.blocks = serverBlocks;
      internal.blockIndex.clear();
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

/** Server-rendered message rows to client state. */
export function messageStateFromRow(row: {
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
  createdAt: number;
}): MessageState {
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
    createdAt: row.createdAt,
  });
}

