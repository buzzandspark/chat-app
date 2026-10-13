import { describe, expect, it } from "vitest";
import { EFFORTS, normalizeThinking } from "./models";

describe("normalizeThinking", () => {
  it("keeps every effort the API supports", () => {
    for (const effort of EFFORTS) expect(normalizeThinking({ effort })).toEqual({ effort });
  });

  it("maps the older harder flag: true is high, false is low", () => {
    expect(normalizeThinking({ harder: true })).toEqual({ effort: "high" });
    expect(normalizeThinking({ harder: false })).toEqual({ effort: "low" });
  });

  it("falls back to low for anything else", () => {
    for (const value of [undefined, null, "high", 3, [], {}, { effort: "extreme" }, { effort: 2 }, { harder: "yes" }]) {
      expect(normalizeThinking(value)).toEqual({ effort: "low" });
    }
  });
});
