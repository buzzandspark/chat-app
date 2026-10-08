// Client-safe model catalogue (D11); request params live in thinking-config.ts, prices in pricing.ts.
export const MODEL_IDS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5", "claude-haiku-4-5"] as const;
export type ModelId = (typeof MODEL_IDS)[number];
export const DEFAULT_MODEL: ModelId = "claude-sonnet-5-5";

export interface ModelInfo {
  id: ModelId;
  name: string;
  short: string;
  /** Context window in tokens (D12). */
  contextWindow: number;
  /** Whether "Think harder" maps to effort (adaptive thinking) or a toggle (budget). */
  thinking: "adaptive" | "budget";
}

export const MODELS: Record<ModelId, ModelInfo> = {
  "claude-sonnet-5-5": {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    short: "Sonnet 5.5",
    contextWindow: 1_000_000,
    thinking: "adaptive",
  },
  "claude-opus-5-5": {
    id: "claude-opus-5-5",
    name: "Claude Opus 5.5",
    short: "Opus 5.5",
    contextWindow: 1_000_000,
    thinking: "adaptive",
  },
  "claude-haiku-5-5": {
    id: "claude-haiku-5-5",
    name: "Claude Haiku 5.5",
    short: "Haiku 5.5",
    contextWindow: 1_000_000,
    thinking: "adaptive",
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    short: "Haiku 4.5",
    contextWindow: 200_000,
    thinking: "budget",
  },
};

export function isModelId(value: unknown): value is ModelId {
  return typeof value === "string" && (MODEL_IDS as readonly string[]).includes(value);
}

/** Human name for any model string the API may serve, including fallback targets. */
export function modelDisplayName(model: string): string {
  if (isModelId(model)) return MODELS[model].name;
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return model;
  const family = m[1]!.charAt(0).toUpperCase() + m[1]!.slice(1);
  return `Claude ${family} ${m[2]}${m[3] ? `.${m[3]}` : ""}`;
}
