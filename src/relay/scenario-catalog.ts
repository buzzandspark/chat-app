// Client-safe scenario catalogue (D24); the scripts live in scenarios.ts and stay out of the client bundle.
export const SCENARIO_NAMES = [
  "normal",
  "long_reply",
  "slow_tokens",
  "bursty_tokens",
  "giant_code_block",
  "table_mid_stream",
  "dropped_connection",
  "stalled_stream",
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
  "options_reply",
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
  /** Transport fault applied by the route: after N events the response goes silent and never closes (half-open socket). */
  stallAfterEvents?: number;
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
  stalled_stream: {
    name: "stalled_stream",
    title: "Stalled stream",
    blurb: "The SSE response goes silent after 30 events without closing; the watchdog resumes it.",
    stallAfterEvents: 30,
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
  options_reply: { name: "options_reply", title: "Reply with options", blurb: "Three approaches to choose between; Explore options appears." },
};
