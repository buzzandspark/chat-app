import { isIP } from "node:net";
import { env } from "@shared/env";

/** Set by the proxy on every API request to the address below, for better-auth: whatever the client sent there is dropped. */
export const CLIENT_ADDRESS_HEADER = "x-chat-client-address";

export function trustedIpHeader(): string | undefined {
  return env.TRUSTED_IP_HEADER;
}

export function trustProxyHops(): number {
  return env.TRUST_PROXY_HOPS ?? (env.isProd ? 1 : 0);
}

/**
 * The client address as the trusted proxy saw it: the one address in `TRUSTED_IP_HEADER`, else the X-Forwarded-For entry
 * `TRUST_PROXY_HOPS` from the right (1 on Railway), never the leftmost, which the client wrote. Null without one.
 */
export function forwardedAddress(headers: Headers): string | null {
  const header = trustedIpHeader();
  const hops = trustProxyHops();
  const raw = header ? headers.get(header) : hops > 0 ? fromRight(headers.get("x-forwarded-for"), hops) : null;
  if (raw === null) return null;
  // `[2001:db8::1]:443` and `fe80::1%eth0`: the brackets, port and zone are not part of the address.
  const value = raw.trim().replace(/^\[([^\]]*)\](?::\d+)?$/, "$1").replace(/%.*$/, "");
  return isIP(value) ? value : null;
}

/** The X-Forwarded-For entry `hops` from the right; null with fewer entries, which did not all come from a proxy. */
function fromRight(forwarded: string | null, hops: number): string | null {
  const parts = (forwarded ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - hops] ?? null;
}
