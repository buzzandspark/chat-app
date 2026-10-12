import type {
  InterruptedReason,
  MessageStatus,
  RefusalInfo,
  RelayError,
  StopReason,
  Timings,
  UsageSummary,
} from "@shared/types";
import type { StoredContentBlock } from "@shared/blocks";

// Producer events carry seq, their index in the buffer; control events (snapshot, GET-path terminals)
// carry seq null and bypass dedupe. t is ms since generation start on the server clock.
interface RelayEventBase {
  seq: number | null;
  generationId: string;
  t: number;
}

export interface InputTransformation {
  type: string;
  path?: string;
  reason?: string;
}

export interface MessageSnapshot {
  id: string;
  chatId: string;
  role: "assistant";
  content: StoredContentBlock[];
  status: MessageStatus;
  requestedModel: string | null;
  servingModel: string | null;
  stopReason: string | null;
  refusal: RefusalInfo | null;
  error: RelayError | null;
  timings: Timings | null;
  generationId: string | null;
  /** The last producer seq the saved content covers; a client ahead of it keeps its own text. */
  lastSeq?: number | null;
}

export type ServerTimings = NonNullable<Timings["server"]>;

export type RelayEventBody =
  | {
      type: "started";
      chatId: string;
      messageId: string;
      userMessageId: string;
      requestedModel: string;
      /** The scripted scenario this reply comes from, if any; Continue and retries keep it. */
      scenario?: string | null;
    }
  | {
      type: "message_start";
      apiMessageId: string;
      model: string;
      inputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      inputTransformations: InputTransformation[];
    }
  | { type: "block_start"; index: number; block: "text" | "thinking" | "redacted_thinking" | "tool_use" }
  | { type: "text_delta"; index: number; text: string }
  | { type: "thinking_delta"; index: number; text: string }
  | { type: "block_stop"; index: number }
  | {
      type: "fallback_boundary";
      index: number;
      from: string;
      to: string;
      category: string | null;
      /** False when the switch happened before any text was streamed. */
      visible: boolean;
    }
  | { type: "refusal"; category: string | null; explanation: string | null; hadText: boolean }
  | {
      type: "done";
      stopReason: StopReason | null;
      servingModel: string;
      usage: UsageSummary;
      timings: ServerTimings;
    }
  | { type: "stopped"; servingModel: string | null; usage: UsageSummary | null }
  | { type: "interrupted"; reason: InterruptedReason; message?: string }
  | { type: "error"; error: RelayError }
  | { type: "snapshot"; status: MessageStatus; message: MessageSnapshot };

export type RelayEvent = RelayEventBase & RelayEventBody;
export type RelayEventType = RelayEvent["type"];

const TERMINAL_EVENT_TYPES: ReadonlySet<RelayEventType> = new Set([
  "done",
  "stopped",
  "interrupted",
  "error",
]);

export function isTerminal(event: { type: RelayEventType }): boolean {
  return TERMINAL_EVENT_TYPES.has(event.type);
}

export function isControl(event: { seq: number | null }): boolean {
  return event.seq === null;
}
