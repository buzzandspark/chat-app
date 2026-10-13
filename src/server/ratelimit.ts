import "server-only";
import { isIP } from "node:net";
import { RateLimiter } from "@relay/ratelimit";
import type { ApiError } from "@shared/api";
import { env } from "@shared/env";
import type { UserRole } from "@shared/types";
import { forwardedAddress, trustedIpHeader, trustProxyHops } from "./client-address";

interface Limiters {
  seedLongChat: RateLimiter;
  guestStart: RateLimiter;
  guestStartAll: RateLimiter;
  guestSend: RateLimiter;
  guestSendIp: RateLimiter;
  guestRewrite: RateLimiter;
  guestRewriteIp: RateLimiter;
  search: RateLimiter;
  guestSearch: RateLimiter;
  guestSearchIp: RateLimiter;
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
    // A guest's sends (replies, forks, declared winners) and Explore rewrites, per guest and per address.
    // The daily counts bound memory; the spend budgets are the daily limit.
    guestSend: env.e2e ? new RateLimiter(600, 6000) : new RateLimiter(12, 1000),
    guestSendIp: env.e2e ? new RateLimiter(600, 6000) : new RateLimiter(40, 6000),
    guestRewrite: env.e2e ? new RateLimiter(600, 6000) : new RateLimiter(10, 300),
    guestRewriteIp: env.e2e ? new RateLimiter(600, 6000) : new RateLimiter(30, 3000),
    // Searches run synchronously on the one process. A debounced keystroke is at most five a second.
    search: env.e2e ? new RateLimiter(600, 6000) : new RateLimiter(120, 10_000),
    guestSearch: env.e2e ? new RateLimiter(600, 6000) : new RateLimiter(60, 1000),
    guestSearchIp: env.e2e ? new RateLimiter(600, 6000) : new RateLimiter(120, 5000),
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

/** Keys for the client address the trusted proxy saw (see `forwardedAddress`); a missing one shares `unknown`. */
export function clientKeys(request: Request): ClientKeys {
  // Without a trusted proxy every forwarding header is the client's own word: one shared key then.
  if (!trustedIpHeader() && !(trustProxyHops() > 0)) return { ip: "local", budgetKeys: ["ip:local"] };
  const raw = forwardedAddress(request.headers);
  if (raw === null) return { ip: "unknown", budgetKeys: ["ip:unknown"] };
  const address = parseIp(raw);
  if (typeof address === "string") return { ip: address, budgetKeys: [`ip:${address}`] };
  // An IPv6 client usually holds a whole /64, and a site a /48: key by those prefixes, not by each address.
  const prefix = (groups: number) => `${address.slice(0, groups).map((g) => g.toString(16)).join(":")}::/${groups * 16}`;
  return { ip: prefix(4), budgetKeys: [`ip:${prefix(4)}`, `ip48:${prefix(3)}`] };
}

export function clientIp(request: Request): string {
  return clientKeys(request).ip;
}

/** An IPv4 address, or an IPv6 address's eight groups (IPv4-mapped ones as IPv4). */
function parseIp(value: string): string | number[] {
  if (isIP(value) === 4) return value;
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

/** A guest's new reply, fork or declared winner: refused while the guest or its address is over its rate, and counted only when both allow it. */
export function refuseGuestSend(request: Request, userId: string): Response | null {
  const { guestSend, guestSendIp } = getLimiters();
  return refuse(guestSend, guestSendIp, request, userId);
}

/** A guest's Explore rewrite, limited the same way. */
export function refuseGuestRewrite(request: Request, userId: string): Response | null {
  const { guestRewrite, guestRewriteIp } = getLimiters();
  return refuse(guestRewrite, guestRewriteIp, request, userId);
}

/** A search: refused while the user (and, for a guest, its address) is over its rate. */
export function refuseSearch(request: Request, user: { id: string; role: UserRole }): Response | null {
  const { search, guestSearch, guestSearchIp } = getLimiters();
  if (user.role === "guest") return refuse(guestSearch, guestSearchIp, request, user.id);
  const result = search.check(user.id);
  return result.ok ? null : tooMany(result.retryAfterMs);
}

function refuse(perGuest: RateLimiter, perIp: RateLimiter, request: Request, userId: string): Response | null {
  const ip = clientIp(request);
  const mine = perGuest.check(userId, false);
  const shared = perIp.check(ip, false);
  if (!mine.ok || !shared.ok) return tooMany(Math.max(mine.retryAfterMs, shared.retryAfterMs));
  perGuest.check(userId);
  perIp.check(ip);
  return null;
}

export function tooMany(retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    { error: "rate_limited", retryAfterMs } satisfies ApiError,
    { status: 429, headers: { "retry-after": String(seconds), "cache-control": "no-store" } },
  );
}
