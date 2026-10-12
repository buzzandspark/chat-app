import "server-only";
import { isIP } from "node:net";
import { RateLimiter } from "@relay/ratelimit";
import { env } from "@shared/env";

interface Limiters {
  seedLongChat: RateLimiter;
  guestStart: RateLimiter;
  guestStartAll: RateLimiter;
}

const g = globalThis as unknown as { __chatLimiters?: Limiters };

/** Per-IP or per-user windows for the open write endpoints (in memory: one process). */
export function getLimiters(): Limiters {
  if (g.__chatLimiters) return g.__chatLimiters;
  const limiters: Limiters = {
    // The e2e projects share one dev user and each seeds a long chat; the harness is not the abuse case.
    seedLongChat: env.e2e ? new RateLimiter(60, 600) : new RateLimiter(2, 10),
    // New guests per address and across every address. They guard database rows, not spend, so they
    // leave room for a shared address.
    guestStart: env.e2e ? new RateLimiter(60, 600) : new RateLimiter(10, 100),
    guestStartAll: env.e2e ? new RateLimiter(600, 6000) : new RateLimiter(60, 3000),
  };
  // Idle keys are dropped every ten minutes, so a day of distinct callers does not pile up in memory.
  // Started here, once with the limiters, not per call: a timer per request would never be cleared.
  for (const limiter of Object.values(limiters)) limiter.startSweeper();
  g.__chatLimiters = limiters;
  return limiters;
}

export interface ClientKeys {
  /** The in-memory limiters' key: an IPv4 address, an IPv6 /64, or a shared `local` or `unknown`. */
  ip: string;
  /** The spend budgets it is charged to: `ip:` plus that key and, for IPv6, `ip48:` plus its /48. */
  budgetKeys: string[];
}

export function trustedIpHeader(): string | undefined {
  return process.env.TRUSTED_IP_HEADER?.trim().toLowerCase() || undefined;
}

/**
 * The client address as the trusted proxy saw it: the one address in `TRUSTED_IP_HEADER`, else the X-Forwarded-For entry
 * `TRUST_PROXY_HOPS` from the right (1 on Railway), never the leftmost, which the client wrote. A missing one shares `unknown`.
 */
export function clientKeys(request: Request): ClientKeys {
  const header = trustedIpHeader();
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? (env.isProd ? 1 : 0));
  // Without a trusted proxy every forwarding header is the client's own word: one shared key then.
  if (!header && !(hops > 0)) return { ip: "local", budgetKeys: ["ip:local"] };
  const raw = header ? request.headers.get(header) : fromRight(request.headers.get("x-forwarded-for"), hops);
  const address = raw === null ? null : parseIp(raw);
  if (address === null) return { ip: "unknown", budgetKeys: ["ip:unknown"] };
  if (typeof address === "string") return { ip: address, budgetKeys: [`ip:${address}`] };
  // An IPv6 client usually holds a whole /64, and a site a /48: key by those prefixes, not by each address.
  const prefix = (groups: number) => `${address.slice(0, groups).map((g) => g.toString(16)).join(":")}::/${groups * 16}`;
  return { ip: prefix(4), budgetKeys: [`ip:${prefix(4)}`, `ip48:${prefix(3)}`] };
}

export function clientIp(request: Request): string {
  return clientKeys(request).ip;
}

/** The X-Forwarded-For entry `hops` from the right; null with fewer entries, which did not all come from a proxy. */
function fromRight(forwarded: string | null, hops: number): string | null {
  const parts = (forwarded ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - hops] ?? null;
}

/** An IPv4 address, or an IPv6 address's eight groups (IPv4-mapped ones as IPv4); null if it is not one address. */
function parseIp(raw: string): string | number[] | null {
  // `[2001:db8::1]:443` and `fe80::1%eth0`: the brackets, port and zone are not part of the address.
  const value = raw.trim().replace(/^\[([^\]]*)\](?::\d+)?$/, "$1").replace(/%.*$/, "");
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return null;
  // A trailing dotted quad (`::ffff:1.2.3.4`) is the last two groups.
  const hex = value.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_, a: string, b: string, c: string, d: string) =>
    `${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`,
  );
  const [head = "", tail] = hex.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right].map((g) => parseInt(g, 16));
  // `::ffff:a.b.c.d` is an IPv4 client on a dual-stack socket.
  if (groups.slice(0, 6).join(":") === "0:0:0:0:0:65535") {
    const [hi = 0, lo = 0] = groups.slice(6);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return groups;
}

export function tooMany(retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    { error: "rate_limited", retryAfterMs },
    { status: 429, headers: { "retry-after": String(seconds), "cache-control": "no-store" } },
  );
}
