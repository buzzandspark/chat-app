"use client";
import { useEffect, useState } from "react";
import { refreshUsage, useLiveUsage } from "@client/store/usage";
import type { CapUsage } from "@shared/api";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Spend against the cap along the header's bottom border; a taller transparent strip is the hover target. */
export function UsageBar({ initial }: { initial: CapUsage }) {
  const live = useLiveUsage();
  // Pages can't send a refreshed session cookie; this one route call per load lets the daily refresh reach the browser.
  useEffect(refreshUsage, []);
  // The server's figures win until a later read (a sign-in re-renders the layout with the new account's).
  const [fromServer, setFromServer] = useState({ initial, seq: live.seq });
  if (initial !== fromServer.initial) setFromServer({ initial, seq: live.seq });
  const usage = live.usage && live.seq > fromServer.seq ? live.usage : initial;
  if (usage.capUsd === null) return null;
  const share = usage.capUsd > 0 ? Math.min(1, usage.spentUsd / usage.capUsd) : 1;
  const label = `${usd(usage.spentUsd)} of ${usd(usage.capUsd)} used (${Math.round(share * 100)}%)`;
  return (
    // Placed by this wrapper: `.tip` makes its own element relative, for the tooltip. z-20: above the fork
    // tab strip right under the header (z-10, later in the page), below the phone sidebar's backdrop (z-30).
    <div className="absolute inset-x-0 -bottom-1.5 z-20 h-3">
      <div
        tabIndex={0}
        role="meter"
        aria-label="Spending cap"
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
