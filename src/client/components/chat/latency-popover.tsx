"use client";
import { Timer } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IconButton } from "../ui/icon-button";
import type { Timings, UsageSummary } from "@shared/types";

function ms(a: number | undefined, b: number | undefined): string {
  if (a === undefined || b === undefined) return "–";
  return `${Math.max(0, Math.round(b - a))} ms`;
}

/** D20: server and client intervals are on different clocks, joined by message id, never compared. */
export function LatencyPopover({ timings, usage }: { timings: Timings | null; usage: UsageSummary | null }) {
  const s = timings?.server;
  const c = timings?.client;
  const rows: Array<[string, string]> = [
    ["Client: sent → first byte", ms(c?.sent, c?.firstByte)],
    ["Client: first byte → first paint", ms(c?.firstByte, c?.firstPaint)],
    ["Client: sent → done", ms(c?.sent, c?.done)],
    ["Server: received → upstream first token", ms(s?.received, s?.upstreamFirstToken)],
    ["Server: upstream first token → first relayed", ms(s?.upstreamFirstToken, s?.firstRelayed)],
    ["Server: received → done", ms(s?.received, s?.done)],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton label="Latency breakdown" className="text-muted-foreground">
          <Timer />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] text-small">
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {s?.declinedAttempt ? (
          <p className="mt-2 text-caption text-muted-foreground">First-token interval includes a declined attempt (safety fallback).</p>
        ) : null}
        {usage ? (
          <p className="mt-2 text-caption text-muted-foreground">
            {usage.inputTokens} in · {usage.outputTokens} out · cache {usage.cacheReadTokens} read / {usage.cacheWriteTokens} write ·{" "}
            ${usage.costUsd.toFixed(4)}
            {usage.estimated ? " (estimated)" : ""}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
