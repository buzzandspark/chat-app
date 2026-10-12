import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getLimiters } from "./ratelimit";

const g = globalThis as unknown as { __chatLimiters?: ReturnType<typeof getLimiters> };

describe("getLimiters", () => {
  beforeEach(() => {
    delete g.__chatLimiters;
  });
  afterEach(() => {
    for (const limiter of Object.values(g.__chatLimiters ?? {})) limiter.stopSweeper();
    delete g.__chatLimiters;
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
