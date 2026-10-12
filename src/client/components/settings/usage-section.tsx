import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ModelUsage, UsageSummary, UsageTotals } from "@server/settings";

// Rendered by the server page only: no client JS.

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function usd(n: number): string {
  return n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

function Cell({ totals, className }: { totals: UsageTotals; className: string }) {
  return (
    <td className={cn("pl-3 text-right align-middle tabular-nums", className)}>
      <div className="text-small font-medium">{usd(totals.costUsd)}</div>
      <div className="text-caption text-muted-foreground">
        {compact.format(totals.inputTokens)} in · {compact.format(totals.outputTokens)} out
      </div>
    </td>
  );
}

/** A total and its models, tight together; the group's own padding sits above its border and below its last row. */
function UsageGroup({ name, testId, period, models }: { name: string; testId: string; period: { month: UsageTotals; all: UsageTotals }; models: ModelUsage[] }) {
  const pad = (i: number) => cn(i === 0 ? "pt-3" : "pt-1.5", i === models.length ? "pb-3" : "pb-1.5");
  return (
    <>
      <tr className="border-t border-border" data-testid={testId}>
        <th scope="row" className={cn("text-left align-middle text-small font-medium", pad(0))}>
          {name}
        </th>
        <Cell totals={period.month} className={pad(0)} />
        <Cell totals={period.all} className={pad(0)} />
      </tr>
      {models.map((m, i) => (
        <tr key={m.model} data-testid="usage-model">
          <th scope="row" className={cn("pl-4 text-left align-middle text-small font-normal text-foreground", pad(i + 1))}>
            {m.label}
          </th>
          <Cell totals={m.month} className={pad(i + 1)} />
          <Cell totals={m.all} className={pad(i + 1)} />
        </tr>
      ))}
    </>
  );
}

export function UsageSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      <h2 className="text-title font-semibold">Usage</h2>
      <Skeleton className="h-36" />
    </div>
  );
}

/** Spend on chat replies and on Explore options, each in total and by model, this month and all time, and the cap when there is one. */
export function UsageSection({ usage }: { usage: UsageSummary }) {
  const { capUsd, spentUsd } = usage;
  const share = capUsd === null ? 0 : capUsd > 0 ? Math.min(1, spentUsd / capUsd) : 1;
  return (
    <section aria-labelledby="settings-usage" className="space-y-2">
      <h2 id="settings-usage" className="text-title font-semibold">
        Usage
      </h2>
      <table className="w-full border-collapse" aria-labelledby="settings-usage">
        <thead>
          <tr className="text-caption text-muted-foreground">
            <td />
            <th scope="col" className="pb-1 pl-3 text-right font-normal">
              This month
            </th>
            <th scope="col" className="pb-1 pl-3 text-right font-normal">
              All time
            </th>
          </tr>
        </thead>
        <tbody>
          <UsageGroup name="Chats" testId="usage-chats" period={{ month: usage.month.chats, all: usage.all.chats }} models={usage.chatModels} />
          <UsageGroup name="Explore" testId="usage-explore" period={{ month: usage.month.explore, all: usage.all.explore }} models={usage.exploreModels} />
        </tbody>
      </table>
      {capUsd !== null ? (
        <div className="space-y-1.5 border-t border-border pt-2.5" data-testid="usage-cap">
          <div className="flex items-baseline justify-between gap-3 text-small">
            <span className="font-medium">Cap</span>
            <span className="tabular-nums">
              {usd(spentUsd)} of {usd(capUsd)}
            </span>
          </div>
          <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full", share >= 1 ? "bg-destructive" : "bg-primary")} style={{ width: `${share * 100}%` }} />
          </div>
        </div>
      ) : null}
    </section>
  );
}
