import { isTerminal, type RelayEvent, type RelayEventBody } from "./events";

export type Subscriber = (event: RelayEvent) => void;

export interface GenerationBuffer {
  events: RelayEvent[];
  subscribers: Set<Subscriber>;
  terminal: boolean;
  startedAt: number;
  evictAt: number | null;
}

export interface EventStoreOptions {
  /** Completed generations are evicted this long after their terminal event (D3). */
  evictAfterMs?: number;
  now?: () => number;
}

/**
 * D3: `Map<generationId, { events, subscribers, terminal }>`. Sequence numbers
 * are the array index. `append` pushes and notifies subscribers synchronously
 * so a connected client sees a delta in the same tick the producer did.
 */
export class EventStore {
  private buffers = new Map<string, GenerationBuffer>();
  private evictAfterMs: number;
  private now: () => number;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(options: EventStoreOptions = {}) {
    this.evictAfterMs = options.evictAfterMs ?? 10 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  open(generationId: string): GenerationBuffer {
    const existing = this.buffers.get(generationId);
    if (existing) return existing;
    const buffer: GenerationBuffer = {
      events: [],
      subscribers: new Set(),
      terminal: false,
      startedAt: this.now(),
      evictAt: null,
    };
    this.buffers.set(generationId, buffer);
    return buffer;
  }

  has(generationId: string): boolean {
    return this.buffers.has(generationId);
  }

  get(generationId: string): GenerationBuffer | undefined {
    return this.buffers.get(generationId);
  }

  /** Appends a producer event, assigning `seq` and `t`, and notifies subscribers. */
  append(generationId: string, body: RelayEventBody): RelayEvent {
    const buffer = this.buffers.get(generationId);
    if (!buffer) throw new Error(`no buffer for generation ${generationId}`);
    if (buffer.terminal) throw new Error(`generation ${generationId} already terminal`);
    const event = {
      ...body,
      seq: buffer.events.length,
      generationId,
      t: this.now() - buffer.startedAt,
    } as RelayEvent;
    buffer.events.push(event);
    if (isTerminal(event)) {
      buffer.terminal = true;
      buffer.evictAt = this.now() + this.evictAfterMs;
    }
    for (const subscriber of buffer.subscribers) {
      try {
        subscriber(event);
      } catch (err) {
        console.error("[store] subscriber threw", err);
      }
    }
    if (buffer.terminal) buffer.subscribers.clear();
    return event;
  }

  /**
   * Replays buffered events with `seq > after` synchronously, then attaches
   * for live events until the terminal event. Returns an unsubscribe function.
   */
  subscribe(generationId: string, after: number, subscriber: Subscriber): () => void {
    const buffer = this.buffers.get(generationId);
    if (!buffer) throw new Error(`no buffer for generation ${generationId}`);
    for (let i = Math.max(0, after + 1); i < buffer.events.length; i++) subscriber(buffer.events[i]!);
    if (buffer.terminal) return () => {};
    buffer.subscribers.add(subscriber);
    return () => {
      buffer.subscribers.delete(subscriber);
    };
  }

  /** Ids of generations that have not reached a terminal event. */
  running(): string[] {
    const out: string[] = [];
    for (const [id, b] of this.buffers) if (!b.terminal) out.push(id);
    return out;
  }

  /** Evict completed generations past their deadline. Returns evicted ids. */
  sweep(): string[] {
    const now = this.now();
    const evicted: string[] = [];
    for (const [id, b] of this.buffers) {
      if (b.terminal && b.evictAt !== null && b.evictAt <= now) {
        this.buffers.delete(id);
        evicted.push(id);
      }
    }
    return evicted;
  }

  startSweeper(intervalMs = 30_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref();
  }

  stopSweeper(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }

  /** Test and shutdown helper: drop a buffer regardless of state. */
  evict(generationId: string): void {
    this.buffers.delete(generationId);
  }

  clear(): void {
    this.buffers.clear();
  }
}
