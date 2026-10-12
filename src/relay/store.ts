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
  /** Completed generations are evicted this long after their terminal event. */
  evictAfterMs?: number;
  now?: () => number;
}

// Seq numbers are the array index; append notifies synchronously so a connected client
// sees a delta in the same tick as the producer.
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

  /** Replays buffered events with seq > after, then attaches live until the terminal event. */
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

  running(): string[] {
    const out: string[] = [];
    for (const [id, b] of this.buffers) if (!b.terminal) out.push(id);
    return out;
  }

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
