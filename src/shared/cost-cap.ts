// Cost-cap rules shared by the admin console and the admin API. Zod-free so the console does not ship it;
// the server's schemas in cost-cap-schema.ts are built from the same bounds.

/** Upper bound on any cap, so a slipped digit cannot amount to "no cap" either. */
export const MAX_COST_CAP_USD = 100_000;

/** DEFAULT_COST_CAP_USD when the env leaves it unset. */
export const FALLBACK_DEFAULT_COST_CAP_USD = 5;

/**
 * The one wire value that clears a cap. Not JSON `null`: `JSON.stringify` turns NaN and Infinity into
 * `null`, so a client that sends `Number(typo)` would otherwise uncap a user without anyone choosing to.
 */
export const NO_CAP = "none";

/** What the admin API accepts for a cap: dollars, or the explicit no-cap word. */
export type CapField = number | typeof NO_CAP;

export function isCapUsd(n: number): boolean {
  return Number.isFinite(n) && n >= 0 && n <= MAX_COST_CAP_USD;
}

/**
 * Admin-typed text to a cap. Blank comes back as `cap: undefined` so each caller decides what it means
 * (the default on create, a mistake on edit); only the word `none` means no cap.
 */
export function parseCapText(text: string): { ok: true; cap: CapField | undefined } | { ok: false } {
  const t = text.trim().toLowerCase();
  if (t === "") return { ok: true, cap: undefined };
  if (t === NO_CAP) return { ok: true, cap: NO_CAP };
  const n = Number(t);
  return isCapUsd(n) ? { ok: true, cap: n } : { ok: false };
}

/** The `users.cost_cap_usd` value for a cap the API received; NULL only for the explicit word. */
export function capColumn(cap: CapField): number | null {
  return cap === NO_CAP ? null : cap;
}

/** ADR-0004: every invited account is capped, so a create that names no cap gets the default, never NULL. */
export function newUserCap(cap: CapField | undefined, defaultCapUsd: number): number | null {
  return cap === undefined ? defaultCapUsd : capColumn(cap);
}
