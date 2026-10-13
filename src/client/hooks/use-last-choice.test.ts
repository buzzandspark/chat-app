import { afterEach, describe, expect, it } from "vitest";
import { readLastChoice, saveLastChoice } from "./use-last-choice";

afterEach(() => localStorage.clear());

describe("readLastChoice", () => {
  it("reads back a saved model and effort", () => {
    saveLastChoice("u1", { model: "claude-opus-5-5", thinking: { effort: "medium" } });
    expect(readLastChoice("u1")).toEqual({ model: "claude-opus-5-5", thinking: { effort: "medium" } });
  });

  it("reads a choice saved with the older harder flag as an effort", () => {
    localStorage.setItem("chat:settings:u1", JSON.stringify({ model: "claude-sonnet-5-5", thinking: { harder: true } }));
    expect(readLastChoice("u1")).toEqual({ model: "claude-sonnet-5-5", thinking: { effort: "high" } });
    localStorage.setItem("chat:settings:u1", JSON.stringify({ model: "claude-sonnet-5-5", thinking: { harder: false } }));
    expect(readLastChoice("u1").thinking).toEqual({ effort: "low" });
  });

  it("leaves out what was never saved", () => {
    localStorage.setItem("chat:settings:u1", JSON.stringify({ model: "nope" }));
    expect(readLastChoice("u1")).toEqual({});
  });
});
