import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EXPAND_MS, playTabReveal, revealDuration, startTabReveal } from "./tab-reveal";

let clock = 0;
let played: { el: HTMLElement; anim: { currentTime: number | null } }[] = [];

function strip(tabs: number) {
  const el = document.createElement("div");
  for (let i = 0; i < tabs; i++) el.appendChild(document.createElement("div")).setAttribute("data-tab-slot", "");
  return el;
}

beforeEach(() => {
  clock = 1000;
  played = [];
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  // Desktop width, motion allowed.
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("min-width") }));
  Element.prototype.animate = function (this: HTMLElement) {
    const anim = { currentTime: null as number | null, finished: new Promise(() => {}) };
    played.push({ el: this, anim });
    return anim as unknown as Animation;
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("tab reveal", () => {
  const from = new DOMRect(100, 500, 160, 44);

  it("plays on the family's strip, and a strip that mounts midway continues from the same moment", () => {
    startTabReveal("p", from);
    playTabReveal("other", strip(3), document.createElement("div"));
    expect(played).toHaveLength(0);
    playTabReveal("p", strip(3), document.createElement("div"));
    // The morph, and one per tab.
    expect(played).toHaveLength(4);
    // Held while the sheet closes (150 ms at desktop width), then under way.
    expect(played.every((p) => p.anim.currentTime === -150)).toBe(true);
    played = [];
    clock += 150 + EXPAND_MS;
    playTabReveal("p", strip(3), document.createElement("div"));
    expect(played.every((p) => p.anim.currentTime === EXPAND_MS)).toBe(true);
    played = [];
    clock += revealDuration(3);
    playTabReveal("p", strip(3), document.createElement("div"));
    expect(played).toHaveLength(0);
  });

  it("holds longer on a phone, where the sheet takes 250 ms to close", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    startTabReveal("p", from);
    playTabReveal("p", strip(2), document.createElement("div"));
    expect(played).toHaveLength(3);
    expect(played.every((p) => p.anim.currentTime === -250)).toBe(true);
  });

  it("drops a reveal no strip picked up in time, and skips it under reduced motion", () => {
    startTabReveal("p", from);
    clock += 5000;
    playTabReveal("p", strip(2), document.createElement("div"));
    expect(played).toHaveLength(0);
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") }));
    startTabReveal("p", from);
    playTabReveal("p", strip(2), document.createElement("div"));
    expect(played).toHaveLength(0);
  });
});
