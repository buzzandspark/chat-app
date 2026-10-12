const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF: a state-changing API call must come from this site's own pages, never a cross-site form or fetch. */
export function crossSite(method: string, headers: Headers): boolean {
  if (SAFE_METHODS.has(method)) return false;
  const site = headers.get("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  // A browser without Fetch Metadata still sends Origin on a cross-site write; no Origin is not a browser form.
  const origin = headers.get("origin");
  if (!origin) return false;
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}
