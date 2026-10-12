const BASE = "http://same.invalid";

/**
 * A path on this site from an untrusted `next`, or null. Parsed as a browser would (tabs, backslashes,
 * dot segments), then forced to start with exactly one `/`: `/.//evil.com` resolves to `//evil.com`.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, BASE);
    if (url.origin !== BASE) return null;
    return `/${(url.pathname + url.search + url.hash).replace(/^\/+/, "")}`;
  } catch {
    return null;
  }
}
