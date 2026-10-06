import type { ModelId } from "@shared/types";
import type { Script } from "./providers/scripted";
import type { ProviderRequest } from "./providers/types";

/**
 * D24 scenarios. Each is a script the ScriptedProvider streams, or an
 * instruction the engine/route applies (dropped connection, producer
 * restart). Names are stable: the scenario panel, the e2e tests, and the
 * generated fixtures all use them.
 */
export const SCENARIO_NAMES = [
  "normal",
  "long_reply",
  "slow_tokens",
  "bursty_tokens",
  "giant_code_block",
  "table_mid_stream",
  "dropped_connection",
  "rate_limited",
  "overloaded",
  "producer_restart",
  "fallback_pre_output",
  "fallback_mid_stream",
  "refusal_partial",
  "refusal_empty",
  "max_tokens",
  "context_full",
  "thinking_long",
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export function isScenarioName(value: unknown): value is ScenarioName {
  return typeof value === "string" && (SCENARIO_NAMES as readonly string[]).includes(value);
}

export interface ScenarioInfo {
  name: ScenarioName;
  title: string;
  blurb: string;
  /** Transport fault applied by the route: cut the SSE response after N events. */
  dropAfterEvents?: number;
  /** Engine fault: abort the generation after N relayed events and emit `interrupted`. */
  interruptAfterEvents?: number;
}

export const SCENARIOS: Record<ScenarioName, ScenarioInfo> = {
  normal: { name: "normal", title: "Normal reply", blurb: "A short answer at a natural pace." },
  long_reply: { name: "long_reply", title: "Long reply", blurb: "Many paragraphs with headings and lists." },
  slow_tokens: { name: "slow_tokens", title: "Slow tokens", blurb: "One small chunk every 400 ms." },
  bursty_tokens: { name: "bursty_tokens", title: "Bursty tokens", blurb: "Fast bursts with 1.5 s stalls." },
  giant_code_block: { name: "giant_code_block", title: "Giant code block", blurb: "A 600-line fenced block." },
  table_mid_stream: { name: "table_mid_stream", title: "Table mid-stream", blurb: "A table arriving row by row." },
  dropped_connection: {
    name: "dropped_connection",
    title: "Dropped connection",
    blurb: "The SSE response is cut after 40 events; the client resumes.",
    dropAfterEvents: 40,
  },
  rate_limited: { name: "rate_limited", title: "Rate limited (429)", blurb: "Upstream returns 429 with retry-after." },
  overloaded: { name: "overloaded", title: "Overloaded (529)", blurb: "Upstream is overloaded." },
  producer_restart: {
    name: "producer_restart",
    title: "Producer restart",
    blurb: "The generation is aborted mid-stream as if the server restarted.",
    interruptAfterEvents: 60,
  },
  fallback_pre_output: {
    name: "fallback_pre_output",
    title: "Fallback before output",
    blurb: "The requested model declines; a fallback model serves the whole reply.",
  },
  fallback_mid_stream: {
    name: "fallback_mid_stream",
    title: "Fallback mid-stream",
    blurb: "Text, then a safety fallback, then the rest from another model.",
  },
  refusal_partial: {
    name: "refusal_partial",
    title: "Refusal with partial text",
    blurb: "A no-fallback refusal after some text was painted.",
  },
  refusal_empty: { name: "refusal_empty", title: "Refusal before output", blurb: "Declined with a category." },
  max_tokens: { name: "max_tokens", title: "Cut off (max_tokens)", blurb: "The reply hits the output limit." },
  context_full: { name: "context_full", title: "Context full", blurb: "The request is rejected as too long." },
  thinking_long: { name: "thinking_long", title: "Long thinking", blurb: "Several seconds of thinking before text." },
};

const LOREM = [
  "The relay keeps every generation in an in-memory buffer keyed by id, with sequence numbers as array indices.",
  "A client that reconnects asks for events after the last sequence it saw, and the server replays the slice before attaching it live.",
  "Partial content is written to SQLite every two seconds, so a crash loses at most two seconds of text.",
  "Stop is explicit: closing a tab never stops a generation, because the next device to open the chat should see the whole reply.",
  "On shutdown the process stops accepting new generations, aborts upstream requests, persists partials, and exits within the grace period.",
];

function paragraphs(n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(LOREM[i % LOREM.length]!);
  return out.join("\n\n");
}

function longMarkdown(): string {
  const parts: string[] = ["## Why resume works\n"];
  for (let i = 0; i < 12; i++) {
    parts.push(`### Section ${i + 1}\n\n${paragraphs(3)}\n\n- Sequence numbers are indices\n- Control events bypass dedupe\n- Snapshots never shrink text\n`);
  }
  parts.push("\n```ts\nconst seq = buffer.events.length;\nbuffer.events.push({ ...body, seq });\n```\n\nThat is the whole protocol.");
  return parts.join("\n");
}

function giantCode(lines = 600): string {
  const body: string[] = [];
  for (let i = 0; i < lines; i++) {
    body.push(`export function step${i}(input: number): number {\n  return (input * ${i + 1}) % 97; // line ${i}\n}`);
  }
  return `Here is a large module:\n\n\`\`\`ts\n${body.join("\n")}\n\`\`\`\n\nDone.`;
}

function table(rows = 40): string {
  const out = ["Here is the comparison:\n", "| Scenario | Events | Resume | Notes |", "| --- | ---: | :---: | --- |"];
  for (let i = 0; i < rows; i++) {
    out.push(`| scenario_${i} | ${(i + 1) * 17} | ${i % 2 ? "yes" : "no"} | row ${i} of the table |`);
  }
  out.push("\nAll rows arrived.");
  return out.join("\n");
}

const THINKING =
  "The user wants a streaming client that survives disconnects. The key design is sequence-numbered events in a buffer and a resume endpoint. Let me outline the buffer, the resume branches, and what the client does with a snapshot.";

export function scenarioScript(name: ScenarioName, request: ProviderRequest): Script {
  const model = request.model;
  switch (name) {
    case "normal":
      return {
        model,
        ttftMs: 450,
        parts: [
          { kind: "thinking", text: THINKING.slice(0, 120), intervalMs: 20 },
          { kind: "text", text: `Here is how resume works.\n\n${paragraphs(2)}`, intervalMs: 22, jitterMs: 10 },
        ],
      };
    case "long_reply":
      return { model, ttftMs: 500, parts: [{ kind: "text", text: longMarkdown(), chunk: 8, intervalMs: 12 }] };
    case "slow_tokens":
      return { model, ttftMs: 800, parts: [{ kind: "text", text: paragraphs(1), chunk: 3, intervalMs: 400 }] };
    case "bursty_tokens":
      return {
        model,
        ttftMs: 300,
        parts: [{ kind: "text", text: longMarkdown(), chunk: 6, intervalMs: 8, burstEvery: 15, burstPauseMs: 1500 }],
      };
    case "giant_code_block":
      return { model, ttftMs: 400, parts: [{ kind: "text", text: giantCode(), chunk: 24, intervalMs: 10 }] };
    case "table_mid_stream":
      return { model, ttftMs: 400, parts: [{ kind: "text", text: table(), chunk: 5, intervalMs: 35 }] };
    case "dropped_connection":
    case "producer_restart":
      return { model, ttftMs: 300, parts: [{ kind: "text", text: longMarkdown(), chunk: 8, intervalMs: 12 }] };
    case "rate_limited":
      return {
        model,
        ttftMs: 150,
        parts: [],
        throwBefore: { status: 429, type: "rate_limit_error", message: "This request would exceed your rate limit", retryAfter: 20 },
      };
    case "overloaded":
      return {
        model,
        ttftMs: 150,
        parts: [],
        throwBefore: { status: 529, type: "overloaded_error", message: "Overloaded" },
      };
    case "context_full":
      return {
        model,
        ttftMs: 150,
        parts: [],
        throwBefore: { status: 400, type: "invalid_request_error", message: "prompt is too long: 1000421 tokens > 1000000 maximum" },
      };
    case "fallback_pre_output":
      return {
        model: "claude-opus-4-8",
        ttftMs: 2600,
        parts: [
          { kind: "fallback", from: model, to: "claude-opus-4-8", category: "cyber" },
          { kind: "text", text: `Here is the explanation from the fallback model.\n\n${paragraphs(2)}`, intervalMs: 24 },
        ],
        iterations: [
          { type: "message", model, input_tokens: 820, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 820, output_tokens: 160, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        ],
      };
    case "fallback_mid_stream":
      return {
        model,
        ttftMs: 400,
        parts: [
          { kind: "thinking", text: THINKING, intervalMs: 15 },
          { kind: "text", text: `First, the setup. ${paragraphs(1)}`, intervalMs: 24 },
          { kind: "pause", ms: 900 },
          { kind: "fallback", from: model, to: "claude-opus-4-8", category: "cyber" },
          { kind: "text", text: `\n\nContinuing from here. ${paragraphs(2)}`, intervalMs: 24 },
        ],
        iterations: [
          { type: "message", model, input_tokens: 820, output_tokens: 90, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
          { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 900, output_tokens: 180, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, cache_creation: null },
        ],
      };
    case "refusal_partial":
      return {
        model,
        ttftMs: 400,
        parts: [{ kind: "text", text: `Let me start with the overview. ${paragraphs(1)}`, intervalMs: 24 }],
        stopReason: "refusal",
        stopDetails: { category: null, explanation: null },
      };
    case "refusal_empty":
      return {
        model,
        ttftMs: 700,
        parts: [],
        stopReason: "refusal",
        stopDetails: { category: "cyber", explanation: "This request could enable cyber harm." },
      };
    case "max_tokens":
      return {
        model,
        ttftMs: 400,
        parts: [{ kind: "text", text: `${paragraphs(3)}\n\nAnd the final point is that the buffer`, intervalMs: 18 }],
        stopReason: "max_tokens",
      };
    case "thinking_long":
      return {
        model,
        ttftMs: 500,
        parts: [
          { kind: "thinking", text: `${THINKING} ${THINKING} ${THINKING}`, chunk: 10, intervalMs: 25 },
          { kind: "text", text: `After thinking it through: ${paragraphs(2)}`, intervalMs: 24 },
        ],
      };
  }
}

/** Replay fixture path for a demo turn on a given model (D6): varies by turn so a demo chat is not repetitive. */
export function demoFixture(model: ModelId, turn: number): string {
  const pool = ["normal", "long_reply", "table_mid_stream", "thinking_long", "giant_code_block"] as const;
  return `${model}/${pool[turn % pool.length]}`;
}
