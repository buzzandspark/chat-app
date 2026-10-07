"use client";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useNow } from "@client/hooks/use-now";

interface ThinkingBlockProps {
  text: string;
  redacted?: boolean;
  streaming: boolean;
  startedAt: number | null;
  endedAt: number | null;
  /** Auto-collapse on the first text delta only while auto-follow is engaged (D12). */
  collapseSignal: boolean;
  onUserToggle?: (open: boolean) => void;
}

function label(startedAt: number | null, endedAt: number | null, streaming: boolean, now: number): string {
  // A saved reply has no stamps (they are this client's clock): past tense, no number (#66).
  if (!streaming && (startedAt === null || endedAt === null)) return "Thought";
  if (startedAt === null || (endedAt === null && now === 0)) return "Thinking";
  const ms = (endedAt ?? now) - startedAt;
  const s = Math.max(1, Math.round(ms / 1000));
  if (streaming && endedAt === null) return `Thinking for ${s}s`;
  return `Thought for ${s}s`;
}

export function ThinkingBlock({ text, redacted, streaming, startedAt, endedAt, collapseSignal, onUserToggle }: ThinkingBlockProps) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  // Latch: once collapsed while following, stay collapsed even if the user scrolls up.
  const [latched, setLatched] = useState(false);
  if (collapseSignal && !latched) setLatched(true);
  const open = userOpen ?? !latched;
  const ticking = streaming && endedAt === null;
  const now = useNow(ticking ? 1000 : 60_000);

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => {
          setUserOpen(!open);
          onUserToggle?.(!open);
        }}
        aria-expanded={open}
        className="flex min-h-11 items-center gap-1 text-small text-muted-foreground"
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        <span className={cn(streaming && endedAt === null && "animate-pulse")}>{label(startedAt, endedAt, streaming, now)}</span>
      </button>
      {open ? (
        <div className="ml-2 border-l-2 border-border pl-3 text-small text-muted-foreground whitespace-pre-wrap break-words">
          {redacted ? <em>Some reasoning was redacted.</em> : text || <em>…</em>}
        </div>
      ) : null}
    </div>
  );
}
