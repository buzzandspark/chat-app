import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CLIENT_ADDRESS_HEADER } from "./client-address";

vi.mock("server-only", () => ({}));

async function loadWith(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
  vi.resetModules();
  return { ...(await import("./client-address")), ...(await import("@/proxy")) };
}

describe("the client address the proxy hands better-auth", () => {
  afterEach(() => vi.unstubAllEnvs());
  const handed = async (vars: Record<string, string>, headers: Record<string, string>) => {
    const { proxy } = await loadWith(vars);
    const res = proxy(new NextRequest("http://localhost/api/auth/sign-in/email", { method: "POST", headers }));
    return { address: res.headers.get(`x-middleware-request-${CLIENT_ADDRESS_HEADER}`), names: res.headers.get("x-middleware-override-headers")?.split(",") };
  };

  it("is the X-Forwarded-For entry the trusted proxy added, never the client's own", async () => {
    const { address } = await handed({ TRUST_PROXY_HOPS: "1" }, { "x-forwarded-for": "6.6.6.6, 1.2.3.4", [CLIENT_ADDRESS_HEADER]: "6.6.6.6" });
    expect(address).toBe("1.2.3.4");
  });

  it("is dropped without a trusted address, whatever the client sent", async () => {
    const { address, names } = await handed({ TRUST_PROXY_HOPS: "2" }, { "x-forwarded-for": "1.2.3.4", [CLIENT_ADDRESS_HEADER]: "6.6.6.6" });
    expect(address).toBeNull();
    expect(names).not.toContain(CLIENT_ADDRESS_HEADER);
  });

  it("reads a blank TRUST_PROXY_HOPS as unset, so production still trusts one proxy", async () => {
    const { address } = await handed({ NODE_ENV: "production", TRUST_PROXY_HOPS: "", TRUSTED_IP_HEADER: "" }, { "x-forwarded-for": "6.6.6.6, 1.2.3.4" });
    expect(address).toBe("1.2.3.4");
  });

  it("reads TRUSTED_IP_HEADER case-insensitively", async () => {
    const { forwardedAddress } = await loadWith({ TRUSTED_IP_HEADER: " X-Real-IP " });
    expect(forwardedAddress(new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "6.6.6.6" }))).toBe("1.2.3.4");
  });

  it("refuses to load with a TRUST_PROXY_HOPS that is not a whole number of at least 0", async () => {
    for (const value of ["abc", "-1", "1.5"]) await expect(loadWith({ TRUST_PROXY_HOPS: value })).rejects.toThrow();
  });
});
