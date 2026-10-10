export interface ForkOption {
  title: string;
  prompt: string;
}

export const MAX_FORKS = 10;
/** The 5-minute cache TTL counts from the parent reply's request start; past this the first fork rewrites the cache. */
export const CACHE_WARM_MS = 270_000;
export const MAX_OPTION_TITLE = 40;
export const MAX_OPTION_PROMPT = 2000;
/** A click before the options have finished streaming waits this long at most, then opens with what has arrived. */
export const OPTIONS_CLICK_WAIT_MS = 5000;

/** One Haiku call as sent and answered; the browser console shows it in development. */
export interface OptionsTrace {
  model: string;
  system: string;
  user: string;
  response: unknown;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Milliseconds: the API call alone. */
  apiMs: number;
  /** The server's whole detection, from the reply settling to the options being stored. */
  totalMs?: number;
  /** How long the options request was held waiting for the detection. */
  waitedMs?: number;
}

/** One line of a reply's options stream: the count first, the options as they complete, then the final list or an error. */
export interface OptionsEvent {
  count?: number;
  options?: ForkOption[];
  done?: boolean;
  error?: boolean;
  trace?: OptionsTrace | null;
}
