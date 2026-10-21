import { LOWER_IS_BETTER, type MetricKey } from "@shared/evals";

type Format = "pct" | "usd" | "ms";

export interface MetricInfo {
  key: MetricKey;
  label: string;
  hint: string;
  format: Format;
}

export const METRICS: MetricInfo[] = [
  { key: "f1", label: "Detection F1", hint: "Button shown exactly when the reply offers a choice", format: "pct" },
  { key: "falseButtonRate", label: "False buttons", hint: "Replies without a choice that got the button", format: "pct" },
  { key: "countExact", label: "Count exact", hint: "Choices found with the right number of options", format: "pct" },
  { key: "countAgrees", label: "Count matches list", hint: "The button's number equals the options the sheet lists", format: "pct" },
  { key: "coverage", label: "Coverage", hint: "Judge: the options match the reply's, none missing or invented", format: "pct" },
  { key: "promptPass", label: "Prompts pass", hint: "Judge and title checks all pass for a prompt", format: "pct" },
  { key: "faithful", label: "Faithful", hint: "Judge: adds nothing the reply doesn't say", format: "pct" },
  { key: "standalone", label: "Standalone", hint: "Judge: names its option without leaning on the others", format: "pct" },
  { key: "concrete", label: "Concrete", hint: "Judge: asks for something specific", format: "pct" },
  { key: "titleOk", label: "Titles ok", hint: "At most four words, never “Option 1”", format: "pct" },
  { key: "flipRate", label: "Flip rate", hint: "Cases whose button changes between samples", format: "pct" },
  { key: "parseFailRate", label: "Parse failures", hint: "Answers that weren't valid JSON for the schema", format: "pct" },
  { key: "errorRate", label: "Errors", hint: "Calls that broke off or failed", format: "pct" },
  { key: "costPer1k", label: "Cost per 1k replies", hint: "Detection only, at list prices", format: "usd" },
  { key: "countMsP50", label: "Count, p50", hint: "Time until the button can appear", format: "ms" },
  { key: "countMsP95", label: "Count, p95", hint: "Time until the button can appear", format: "ms" },
];

export function formatValue(value: number | null, format: Format): string {
  if (value === null) return "–";
  if (format === "pct") return `${(value * 100).toFixed(1)}%`;
  if (format === "usd") return `$${value.toFixed(2)}`;
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

/** Positive when the change is an improvement, whichever way the metric points. */
export function improvement(key: MetricKey, before: number | null, after: number | null): number | null {
  if (before === null || after === null) return null;
  return LOWER_IS_BETTER.has(key) ? before - after : after - before;
}

export function formatChange(info: MetricInfo, before: number | null, after: number | null): string {
  if (before === null || after === null) return "";
  const diff = after - before;
  if (info.format === "pct") return `${diff >= 0 ? "+" : "−"}${Math.abs(diff * 100).toFixed(1)} pts`;
  return `${diff >= 0 ? "+" : "−"}${formatValue(Math.abs(diff), info.format)}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
