import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { CLIENT_ADDRESS_HEADER } from "./client-address";

vi.mock("server-only", () => ({}));

describe("the client address the proxy hands better-auth", () => {
  afterEach(() => vi.unstubAllEnvs());
  const handed = (headers: Record<string, string>) => {
    const res = proxy(new NextRequest("http://localhost/api/auth/sign-in/email", { method: "POST", headers }));
    return { address: res.headers.get(`x-middleware-request-${CLIENT_ADDRESS_HEADER}`), names: res.headers.get("x-middleware-override-headers")?.split(",") };
  };

  it("is the X-Forwarded-For entry the trusted proxy added, never the client's own", () => {
    vi.stubEnv("TRUST_PROXY_HOPS", "1");
    expect(handed({ "x-forwarded-for": "6.6.6.6, 1.2.3.4", [CLIENT_ADDRESS_HEADER]: "6.6.6.6" }).address).toBe("1.2.3.4");
  });

  it("is dropped without a trusted address, whatever the client sent", () => {
    vi.stubEnv("TRUST_PROXY_HOPS", "2");
    const { address, names } = handed({ "x-forwarded-for": "1.2.3.4", [CLIENT_ADDRESS_HEADER]: "6.6.6.6" });
    expect(address).toBeNull();
    expect(names).not.toContain(CLIENT_ADDRESS_HEADER);
  });
});
