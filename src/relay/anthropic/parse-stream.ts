import type Anthropic from "@anthropic-ai/sdk";
import type { IterationUsage, StoredContentBlock } from "@shared/blocks";
import type { RefusalInfo, StopReason } from "@shared/types";
import type { InputTransformation, RelayEventBody } from "../events";
import { errorEventToRelayError } from "./errors";

type RawStreamEvent = Anthropic.Beta.BetaRawMessageStreamEvent;

/** A mid-stream `error` carried as data (scripted streams, raw SSE). */
interface RawErrorEvent {
  type: "error";
  error: { type?: string; message?: string };
  status?: number;
}

export type NormalizableEvent = RawStreamEvent | RawErrorEvent;

interface BlockAcc {
  type: StoredContentBlock["type"];
  text: string;
  thinking: string;
  signature: string;
  data: string;
  partialJson: string;
  toolId: string;
  toolName: string;
  fallback: { from: string; to: string; category: string | null } | null;
}

export interface StreamAccumulator {
  apiMessageId: string | null;
  startModel: string | null;
  servingModel: string | null;
  blocks: Map<number, BlockAcc>;
  order: number[];
  hasText: boolean;
  /** Fallback boundaries in order. */
  boundaries: Array<{ index: number; from: string; to: string; category: string | null }>;
  stopReason: StopReason | null;
  refusal: RefusalInfo | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    iterations: IterationUsage | null;
  };
  inputTransformations: InputTransformation[];
  messageStopped: boolean;
}

export function createAccumulator(): StreamAccumulator {
  return {
    apiMessageId: null,
    startModel: null,
    servingModel: null,
    blocks: new Map(),
    order: [],
    hasText: false,
    boundaries: [],
    stopReason: null,
    refusal: null,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, iterations: null },
    inputTransformations: [],
    messageStopped: false,
  };
}

function newBlock(type: StoredContentBlock["type"]): BlockAcc {
  return {
    type,
    text: "",
    thinking: "",
    signature: "",
    data: "",
    partialJson: "",
    toolId: "",
    toolName: "",
    fallback: null,
  };
}

/** One raw Anthropic event in, relay event bodies out, accumulator updated. Pure. */
export function normalizeEvent(raw: NormalizableEvent, acc: StreamAccumulator): RelayEventBody[] {
  switch (raw.type) {
    case "message_start": {
      const m = raw.message;
      acc.apiMessageId = m.id;
      acc.startModel = m.model;
      acc.servingModel = m.model;
      acc.usage.inputTokens = m.usage.input_tokens ?? 0;
      acc.usage.cacheReadTokens = m.usage.cache_read_input_tokens ?? 0;
      acc.usage.cacheWriteTokens = m.usage.cache_creation_input_tokens ?? 0;
      if (m.usage.iterations) acc.usage.iterations = m.usage.iterations;
      const transformations = (m as { input_transformations?: InputTransformation[] | null })
        .input_transformations;
      if (transformations) acc.inputTransformations = transformations;
      return [
        {
          type: "message_start",
          apiMessageId: m.id,
          model: m.model,
          inputTokens: acc.usage.inputTokens,
          cacheReadTokens: acc.usage.cacheReadTokens,
          cacheWriteTokens: acc.usage.cacheWriteTokens,
          inputTransformations: acc.inputTransformations,
        },
      ];
    }
    case "content_block_start": {
      const cb = raw.content_block;
      const block = newBlock(cb.type);
      acc.blocks.set(raw.index, block);
      acc.order.push(raw.index);
      switch (cb.type) {
        case "text":
          block.text = cb.text ?? "";
          return [{ type: "block_start", index: raw.index, block: "text" }];
        case "thinking":
          block.thinking = cb.thinking ?? "";
          block.signature = cb.signature ?? "";
          return [{ type: "block_start", index: raw.index, block: "thinking" }];
        case "redacted_thinking":
          block.data = cb.data;
          return [{ type: "block_start", index: raw.index, block: "redacted_thinking" }];
        case "tool_use":
          block.toolId = cb.id;
          block.toolName = cb.name;
          return [{ type: "block_start", index: raw.index, block: "tool_use" }];
        case "fallback": {
          const category = cb.trigger?.category ?? null;
          block.fallback = { from: cb.from.model, to: cb.to.model, category };
          acc.servingModel = cb.to.model;
          const visible = acc.hasText;
          acc.boundaries.push({ index: raw.index, from: cb.from.model, to: cb.to.model, category });
          return [
            { type: "fallback_boundary", index: raw.index, from: cb.from.model, to: cb.to.model, category, visible },
          ];
        }
        default:
          // Unused block types keep their index slot so later indices stay aligned.
          return [];
      }
    }
    case "content_block_delta": {
      const block = acc.blocks.get(raw.index);
      if (!block) return [];
      const d = raw.delta;
      switch (d.type) {
        case "text_delta":
          block.text += d.text;
          acc.hasText = true;
          return [{ type: "text_delta", index: raw.index, text: d.text }];
        case "thinking_delta":
          block.thinking += d.thinking;
          return [{ type: "thinking_delta", index: raw.index, text: d.thinking }];
        case "signature_delta":
          block.signature += d.signature;
          return [];
        case "input_json_delta":
          block.partialJson += d.partial_json;
          return [];
        default:
          return [];
      }
    }
    case "content_block_stop": {
      const block = acc.blocks.get(raw.index);
      if (!block || block.type === "fallback") return [];
      return [{ type: "block_stop", index: raw.index }];
    }
    case "message_delta": {
      const out: RelayEventBody[] = [];
      if (raw.delta.stop_reason) acc.stopReason = raw.delta.stop_reason as StopReason;
      const u = raw.usage;
      if (u) {
        acc.usage.outputTokens = u.output_tokens ?? acc.usage.outputTokens;
        if (u.input_tokens != null) acc.usage.inputTokens = u.input_tokens;
        if (u.cache_read_input_tokens != null) acc.usage.cacheReadTokens = u.cache_read_input_tokens;
        if (u.cache_creation_input_tokens != null) acc.usage.cacheWriteTokens = u.cache_creation_input_tokens;
        if (u.iterations) acc.usage.iterations = u.iterations;
      }
      if (raw.input_transformations) acc.inputTransformations = raw.input_transformations;
      if (raw.delta.stop_reason === "refusal") {
        const details = raw.delta.stop_details;
        acc.refusal = { category: details?.category ?? null, explanation: details?.explanation ?? null };
        out.push({ type: "refusal", ...acc.refusal, hadText: acc.hasText });
      }
      return out;
    }
    case "message_stop":
      acc.messageStopped = true;
      return [];
    case "error":
      return [{ type: "error", error: errorEventToRelayError(raw.error, raw.status) }];
    default:
      return [];
  }
}

// The last fallback block's to.model wins, else message_start's model. Sticky-routed turns have
// no block, so a fallback_message iteration entry is the cross-check.
export function resolveServingModel(acc: StreamAccumulator): string | null {
  const lastBoundary = acc.boundaries[acc.boundaries.length - 1];
  if (lastBoundary) return lastBoundary.to;
  const served = acc.usage.iterations?.find((it) => it.type === "fallback_message");
  if (served && served.type === "fallback_message") return served.model;
  return acc.startModel;
}

export function accumulatedText(acc: StreamAccumulator): string {
  let s = "";
  for (const i of acc.order) {
    const b = acc.blocks.get(i);
    if (b?.type === "text") s += b.text;
  }
  return s;
}
