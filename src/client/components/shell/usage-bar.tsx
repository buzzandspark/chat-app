"use client";
import { useEffect, useState } from "react";
import { useChatStore } from "@client/store/context";

interface CapUsage {
  spentUsd: number;
  capUsd: number | null;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Spend against the cap along the header's bottom border; a taller transparent strip is the hover target. */
export function UsageBar({ initial }: { initial: CapUsage }) {
  const store = useChatStore();
  const [usage, setUsage] = useState(initial);
  // A reply's cost is settled by the time its end reaches the page: read the counter again then.
  useEffect(
    () =>
      store.onReplyEnd(() => {
        fetch("/api/usage")
          .then((res) => (res.ok ? (res.json() as Promise<CapUsage>) : null))
          .then((next) => next && setUsage(next))
          .catch(() => {});
      }),
    [store],
  );
  if (usage.capUsd === null) return null;
  const share = usage.capUsd > 0 ? Math.min(1, usage.spentUsd / usage.capUsd) : 1;
  const label = `${usd(usage.spentUsd)} of ${usd(usage.capUsd)} used (${Math.round(share * 100)}%)`;
  return (
    // Placed by this wrapper: `.tip` makes its own element relative, for the tooltip.
    <div className="absolute inset-x-0 -bottom-1.5 z-10 h-3">
      <div
        tabIndex={0}
        role="meter"
        aria-label="Usage"
        aria-valuemin={0}
        aria-valuemax={usage.capUsd}
        aria-valuenow={Math.min(usage.spentUsd, usage.capUsd)}
        aria-valuetext={label}
        data-tip={label}
        data-testid="usage-bar"
        className="tip flex h-full items-center outline-none"
      >
        <div className="h-0.5 w-full">
          <div className={share >= 1 ? "h-full bg-destructive" : "h-full bg-primary"} style={{ width: `${share * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
