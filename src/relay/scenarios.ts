import type { ModelId } from "@shared/types";
import type { Script } from "./providers/scripted";
import type { ProviderRequest } from "./providers/types";
import { type ScenarioName } from "./scenario-catalog";

export { SCENARIO_NAMES, SCENARIOS, isScenarioName, type ScenarioName } from "./scenario-catalog";

// Server-only scenario scripts (D24); the client-safe catalogue is scenario-catalog.ts.
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

const OPTIONS_REPLY = `There are three ways to take the database from here.

## 1. Keep SQLite

Stay on one file with WAL and nightly backups. Simplest to run; one writer at a time.

## 2. Move to Postgres

A managed instance, connection pooling and real concurrency, at the cost of a migration and a second service to operate.

## 3. Embedded now, managed later

Keep SQLite behind a repository layer so the swap is a deployment change rather than a rewrite.

Pick by how soon you expect more than one writer.`;

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
    case "options_reply":
      return { model, ttftMs: 400, parts: [{ kind: "text", text: OPTIONS_REPLY, chunk: 8, intervalMs: 10 }] };
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
    case "stalled_stream":
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

/** Replay fixture per model for REPLAY_MODE (the harness and local development), varied by turn (D6). */
export function replayFixture(model: ModelId, turn: number): string {
  const pool = ["normal", "long_reply", "table_mid_stream", "thinking_long", "giant_code_block"] as const;
  return `${model}/${pool[turn % pool.length]}`;
}
