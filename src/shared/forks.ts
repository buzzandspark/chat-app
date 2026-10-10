export interface ForkOption {
  title: string;
  prompt: string;
}

export const MAX_FORKS = 10;
/** The 5-minute cache TTL counts from the parent reply's request start; past this the first fork rewrites the cache. */
export const CACHE_WARM_MS = 270_000;
export const MAX_OPTION_TITLE = 40;
export const MAX_OPTION_PROMPT = 2000;
