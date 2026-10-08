import { describe, expect, it } from "vitest";
import { z } from "zod";
import { capColumn, FALLBACK_DEFAULT_COST_CAP_USD, MAX_COST_CAP_USD, NO_CAP, newUserCap, parseCapText } from "./cost-cap";
import { CapFieldSchema, DefaultCapEnvSchema } from "./cost-cap-schema";

describe("newUserCap", () => {
  it("gives a create that names no cap the default, never NULL", () => {
    expect(newUserCap(undefined, 5)).toBe(5);
    expect(newUserCap(undefined, 12.5)).toBe(12.5);
  });
  it("keeps an explicit cap, zero included", () => {
    expect(newUserCap(20, 5)).toBe(20);
    expect(newUserCap(0, 5)).toBe(0);
  });
  it("stores NULL only for the explicit no-cap word", () => {
    expect(newUserCap(NO_CAP, 5)).toBeNull();
    expect(capColumn(NO_CAP)).toBeNull();
    expect(capColumn(3)).toBe(3);
  });
});

describe("parseCapText", () => {
  it("leaves blank to the caller", () => {
    expect(parseCapText("")).toEqual({ ok: true, cap: undefined });
    expect(parseCapText("   ")).toEqual({ ok: true, cap: undefined });
  });
  it("reads dollars and the no-cap word", () => {
    expect(parseCapText(" 7.5 ")).toEqual({ ok: true, cap: 7.5 });
    expect(parseCapText("0")).toEqual({ ok: true, cap: 0 });
    expect(parseCapText("None")).toEqual({ ok: true, cap: NO_CAP });
  });
  it("refuses typos, negatives, infinities and caps over the bound", () => {
    for (const text of ["abc", "5$", "-1", "Infinity", "1e400", String(MAX_COST_CAP_USD + 1), "null"]) {
      expect(parseCapText(text), text).toEqual({ ok: false });
    }
  });
});

describe("CapFieldSchema", () => {
  const Body = z.object({ costCapUsd: CapFieldSchema.optional() });
  it("accepts dollars, the no-cap word, or nothing", () => {
    expect(Body.parse({ costCapUsd: 10 })).toEqual({ costCapUsd: 10 });
    expect(Body.parse({ costCapUsd: NO_CAP })).toEqual({ costCapUsd: NO_CAP });
    expect(Body.parse({})).toEqual({});
  });
  it("refuses null, since JSON carries a client's NaN as null", () => {
    expect(JSON.parse(JSON.stringify({ costCapUsd: Number("typo") }))).toEqual({ costCapUsd: null });
    expect(Body.safeParse({ costCapUsd: null }).success).toBe(false);
  });
  it("refuses non-finite, negative, oversized and stringly numbers", () => {
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, -1, MAX_COST_CAP_USD + 1, "5", "unlimited"]) {
      expect(CapFieldSchema.safeParse(v).success, String(v)).toBe(false);
    }
  });
});

describe("DefaultCapEnvSchema", () => {
  const Env = z.object({ DEFAULT_COST_CAP_USD: DefaultCapEnvSchema });
  it("falls back when unset or blank", () => {
    expect(Env.parse({}).DEFAULT_COST_CAP_USD).toBe(FALLBACK_DEFAULT_COST_CAP_USD);
    expect(Env.parse({ DEFAULT_COST_CAP_USD: "" }).DEFAULT_COST_CAP_USD).toBe(FALLBACK_DEFAULT_COST_CAP_USD);
  });
  it("reads a positive number of dollars", () => {
    expect(Env.parse({ DEFAULT_COST_CAP_USD: "25" }).DEFAULT_COST_CAP_USD).toBe(25);
    expect(Env.parse({ DEFAULT_COST_CAP_USD: " 0.5 " }).DEFAULT_COST_CAP_USD).toBe(0.5);
  });
  it("fails the boot on a value that would not cap anyone sensibly", () => {
    for (const v of ["0", "-5", "abc", "Infinity", String(MAX_COST_CAP_USD + 1)]) {
      expect(Env.safeParse({ DEFAULT_COST_CAP_USD: v }).success, v).toBe(false);
    }
  });
});
