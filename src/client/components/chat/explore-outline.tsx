"use client";
import { useId } from "react";

/** The button's dashed gradient outline, drawn behind its content; the tab strip's reveal starts from it too. */
export function ExploreOutline({ marching = false, rotating = false }: { marching?: boolean; rotating?: boolean }) {
  const gradient = useId();
  return (
    <svg aria-hidden className="pointer-events-none absolute inset-0 -z-10 size-full">
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--primary)" />
          <stop offset="0.5" stopColor="var(--chart-2)" />
          <stop offset="1" stopColor="var(--chart-3)" />
        </linearGradient>
      </defs>
      <rect
        data-part="border"
        x="1"
        y="1"
        rx="7"
        // The animation lives in an unlayered rule that no utility can override, so the class itself is the switch.
        // While it's up the whole dashed border turns slowly clockwise; waiting or forking, faster.
        className={marching ? "explore-border" : rotating ? "explore-rotate" : undefined}
        style={{ width: "calc(100% - 2px)", height: "calc(100% - 2px)" }}
        fill="none"
        stroke={`url(#${gradient})`}
        strokeWidth="1.5"
        strokeDasharray="6 4"
      />
    </svg>
  );
}
