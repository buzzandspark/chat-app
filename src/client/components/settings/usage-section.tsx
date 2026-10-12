import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { UsageSummary, UsageTotals } from "@server/settings";

// Rendered by the server page only: no client JS.

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

function usd(n: number): string {
  return n > 0 && n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`;
}

function Cell({ totals }: { totals: UsageTotals }) {
  return (
    <td className="py-2.5 pl-3 text-right align-top tabular-nums">
      <div className="text-small font-medium">{usd(totals.costUsd)}</div>
      <div className="text-caption text-muted-foreground">
        {compact.format(totals.inputTokens)} in · {compact.format(totals.outputTokens)} out
      </div>
    </td>
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

/** Spend on chat replies (in total and by model) and on Explore options, this month and all time, and the cap when there is one. */
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
          <tr className="border-t border-border" data-testid="usage-chats">
            <th scope="row" className="py-2.5 text-left align-top text-small font-medium">
              Chats
            </th>
            <Cell totals={usage.month.chats} />
            <Cell totals={usage.all.chats} />
          </tr>
          {usage.chatModels.map((m) => (
            <tr key={m.model} data-testid="usage-model">
              <th scope="row" className="py-1.5 pl-3 text-left align-top text-small font-normal text-muted-foreground">
                {m.label}
              </th>
              <Cell totals={m.month} />
              <Cell totals={m.all} />
            </tr>
          ))}
          <tr className="border-t border-border" data-testid="usage-explore">
            <th scope="row" className="py-2.5 text-left align-top font-normal">
              <div className="text-small font-medium">Explore</div>
              <div className="text-caption text-muted-foreground">Haiku</div>
            </th>
            <Cell totals={usage.month.explore} />
            <Cell totals={usage.all.explore} />
          </tr>
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
