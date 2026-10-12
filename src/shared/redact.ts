// An invite token sets the account's password (also the reset path, admins included), so every path or URL bound for
// error reporting passes through here. `[` is not in the class, so `invite/[token]` and redacted strings stay as they are.
const INVITE_TOKEN = /\/invite\/[\w%-]+/g;

export function redactInvitePath(text: string): string {
  return text.replace(INVITE_TOKEN, "/invite/[redacted]");
}

/**
 * Redacts every string in a copy of a Sentry event or breadcrumb, since the URL can sit in many fields.
 * Only arrays and plain objects are walked; a cycle maps to its copy.
 */
export function redactInviteTokens<T>(value: T): T {
  return walk(value, new WeakMap()) as T;
}

function walk(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof value === "string") return redactInvitePath(value);
  if (value === null || typeof value !== "object") return value;
  const done = seen.get(value);
  if (done !== undefined) return done;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    seen.set(value, out);
    for (const item of value) out.push(walk(item, seen));
    return out;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  seen.set(value, out);
  for (const [key, item] of Object.entries(value)) out[key] = walk(item, seen);
  return out;
}
