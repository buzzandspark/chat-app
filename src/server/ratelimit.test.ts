import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getLimiters } from "./ratelimit";

const g = globalThis as unknown as { __cadenceLimiters?: ReturnType<typeof getLimiters> };

describe("getLimiters", () => {
  beforeEach(() => {
    delete g.__cadenceLimiters;
  });
  afterEach(() => {
    for (const limiter of Object.values(g.__cadenceLimiters ?? {})) limiter.stopSweeper();
    delete g.__cadenceLimiters;
    vi.restoreAllMocks();
  });

  it("starts the sweepers once, not on every call", () => {
    const spy = vi.spyOn(globalThis, "setInterval");
    const first = getLimiters();
    for (let i = 0; i < 20; i++) expect(getLimiters()).toBe(first);
    // One per limiter, all from the first call.
    expect(spy).toHaveBeenCalledTimes(Object.keys(first).length);
  });
});
