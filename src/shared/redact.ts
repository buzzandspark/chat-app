// An invite link is a bearer credential: it sets the account's password, and it is also the reset path for an
// existing account, admins included. Its token must never reach a third party, so every path or URL bound for
// error reporting passes through here. The token is base64url (`issueInvite`); `%` covers a percent-encoded
// copy. `[` is not in the class, so a route file like `invite/[token]/page.tsx` in a stack frame stays readable
// and an already-redacted string is left as it is. `/api/invite/<token>` matches too.
const INVITE_TOKEN = /\/invite\/[\w%-]+/g;

export function redactInvitePath(text: string): string {
  return text.replace(INVITE_TOKEN, "/invite/[redacted]");
}

/**
 * A copy of a Sentry event or breadcrumb with every string redacted: the URL can sit in `request.url`, a
 * `referer` header, the transaction name, a breadcrumb's `data.url`/`from`/`to`, `extra`, or an error message,
 * so walking all of it is simpler than naming fields. Only arrays and plain objects are walked (class instances
 * are left as they are, and the serializer handles them later); a cycle maps to its copy.
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
