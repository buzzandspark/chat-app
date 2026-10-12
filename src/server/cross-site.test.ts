import { describe, expect, it } from "vitest";
import { crossSite } from "./cross-site";

const h = (init: Record<string, string>) => new Headers(init);

describe("crossSite", () => {
  it("lets reads through, and writes from this site's own pages", () => {
    expect(crossSite("GET", h({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(crossSite("POST", h({ "sec-fetch-site": "same-origin" }))).toBe(false);
    expect(crossSite("PATCH", h({ "sec-fetch-site": "none" }))).toBe(false);
  });

  it("refuses a write a cross-site or sibling-subdomain page sent", () => {
    expect(crossSite("POST", h({ "sec-fetch-site": "cross-site", origin: "https://evil.example" }))).toBe(true);
    expect(crossSite("DELETE", h({ "sec-fetch-site": "same-site" }))).toBe(true);
  });

  it("without Fetch Metadata, compares Origin with the host the request was sent to", () => {
    expect(crossSite("POST", h({ origin: "https://app.example", host: "app.example" }))).toBe(false);
    expect(crossSite("POST", h({ origin: "https://app.example", host: "internal:3000", "x-forwarded-host": "app.example" }))).toBe(false);
    expect(crossSite("POST", h({ origin: "https://evil.example", host: "app.example" }))).toBe(true);
    expect(crossSite("POST", h({ origin: "null", host: "app.example" }))).toBe(true);
    // No Origin at all is a script or server, not a browser form.
    expect(crossSite("POST", h({ host: "app.example" }))).toBe(false);
  });
});
