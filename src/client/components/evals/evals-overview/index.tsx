import Link from "next/link";
import type { Calibration, RunFile } from "@shared/evals";
import { METRICS, formatDate, formatValue, type MetricInfo } from "../format";
import { CostChart } from "./cost-chart";
import { Sparkline } from "./sparkline";

// Rendered by the server page only: no client JS.

const TILES = ["f1", "falseButtonRate", "countExact", "promptPass", "costPer1k", "countMsP95"].flatMap((key) => METRICS.filter((m) => m.key === key));
const TABLE = ["f1", "falseButtonRate", "countExact", "coverage", "promptPass", "flipRate", "costPer1k", "countMsP95"].flatMap((key) => METRICS.filter((m) => m.key === key));
// Its answers are deliberately poor; it exists to give the judge failures to catch.
const NOT_COMPARED = new Set(["degraded"]);

function Tile({ info, runs }: { info: MetricInfo; runs: RunFile[] }) {
  const latest = runs.at(-1);
  const points = runs.flatMap((r) => {
    const value = r.summary[info.key];
    return value === null ? [] : [{ value, title: `${r.id}: ${formatValue(value, info.format)}` }];
  });
  return (
    <div className="space-y-1 rounded-lg border border-border p-3">
      <div className="text-caption text-muted-foreground" title={info.hint}>
        {info.label}
      </div>
      <div className="text-title font-semibold tabular-nums">{formatValue(latest?.summary[info.key] ?? null, info.format)}</div>
      <Sparkline points={points} label={info.label} />
    </div>
  );
}

function RunsTable({ runs, caption }: { runs: RunFile[]; caption: string }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className="w-full min-w-[720px] border-collapse text-small">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-caption text-muted-foreground">
            <th scope="col" className="pb-1 text-left font-normal">
              Run
            </th>
            {TABLE.map((m) => (
              <th key={m.key} scope="col" className="pb-1 pl-3 text-right font-normal" title={m.hint}>
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="border-t border-border">
              <th scope="row" className="py-2 text-left font-normal">
                <Link href={`/evals/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                  {r.config.name}
                </Link>
                <div className="text-caption text-muted-foreground">
                  {r.config.model.replace("claude-", "")} · {r.config.effort} · {formatDate(r.createdAt)}
                </div>
              </th>
              {TABLE.map((m) => (
                <td key={m.key} className="py-2 pl-3 text-right tabular-nums">
                  {formatValue(r.summary[m.key], m.format)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JudgeAgreement({ calibration }: { calibration: Calibration | null }) {
  if (!calibration) return <p className="text-small text-muted-foreground">The judge hasn&apos;t been checked against labels yet.</p>;
  const rows = (["faithful", "standalone", "concrete", "coverage"] as const).map((k) => ({ k, ...calibration.criteria[k] }));
  const fmt = (v: number | null) => (v === null ? "–" : v.toFixed(2));
  return (
    <div className="space-y-2">
      <p className="text-small text-muted-foreground">
        {calibration.judgeModel} against labels by {calibration.labelers.join(", ") || "nobody yet"}, {formatDate(calibration.createdAt)}. Cohen&apos;s κ is agreement beyond chance: 1 is perfect, 0 is
        chance, and it&apos;s undefined (–) when the labels hold no failures for a criterion. Tune the rubric on the dev split only; test stays held out.
      </p>
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[480px] border-collapse text-small">
          <thead>
            <tr className="text-caption text-muted-foreground">
              <th scope="col" className="pb-1 text-left font-normal">
                Criterion
              </th>
              {["Items", "Agreement", "κ", "Missed failures", "False alarms"].map((h) => (
                <th key={h} scope="col" className="pb-1 pl-3 text-right font-normal">
                  {h} (dev / test)
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ k, dev, test }) => (
              <tr key={k} className="border-t border-border">
                <th scope="row" className="py-2 text-left font-medium capitalize">
                  {k}
                </th>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {dev.items} / {test.items}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {fmt(dev.agreement)} / {fmt(test.agreement)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {fmt(dev.kappa)} / {fmt(test.kappa)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {fmt(dev.missedFailures)} / {fmt(test.missedFailures)}
                </td>
                <td className="py-2 pl-3 text-right tabular-nums">
                  {fmt(dev.falseAlarms)} / {fmt(test.falseAlarms)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Production runs over time, the configs compared on accuracy and cost, every run, and how far the judge can be trusted. */
export function EvalsOverview({ runs, calibration }: { runs: RunFile[]; calibration: Calibration | null }) {
  const production = runs.filter((r) => r.kind === "production");
  const latest = production.at(-1);
  // The newest run of each config.
  const configs = [...new Map(runs.filter((r) => !NOT_COMPARED.has(r.config.name)).map((r) => [r.config.name, r])).values()];
  return (
    <main className="mx-auto w-full max-w-4xl space-y-10 px-4 pt-8 pb-[max(2rem,env(safe-area-inset-bottom,0px))]">
      <header className="space-y-2">
        <h1 className="text-display font-semibold">Evals</h1>
        <p className="text-body text-muted-foreground">
          After each reply, Claude Haiku decides whether the reply offers the user a choice, and if so writes a follow-up prompt for each option; the Explore button then forks one chat per
          option. These runs score that detector on {latest ? latest.summary.cases : "a set of"} labeled replies: whether the button appears when it should, how many options it finds, and
          whether each prompt is faithful to its option. Each reply is run {latest?.samples ?? 3} times.
        </p>
      </header>

      <section aria-labelledby="evals-production" className="space-y-3">
        <h2 id="evals-production" className="text-title font-semibold">
          What ships
        </h2>
        {latest ? (
          <>
            <p className="text-small text-muted-foreground">
              The latest production run, <Link href={`/evals/${latest.id}`} className="underline underline-offset-2">{latest.id}</Link>, with every production run before it.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TILES.map((info) => (
                <Tile key={info.key} info={info} runs={production} />
              ))}
            </div>
          </>
        ) : (
          <p className="text-small text-muted-foreground">No production run yet.</p>
        )}
      </section>

      {configs.length > 1 ? (
        <section aria-labelledby="evals-configs" className="space-y-3">
          <h2 id="evals-configs" className="text-title font-semibold">
            Accuracy against cost
          </h2>
          <p className="text-small text-muted-foreground">The newest run of each model, effort and prompt. Up and to the left is better; hover a point for its other numbers.</p>
          <CostChart runs={configs} />
          <RunsTable runs={configs} caption="The newest run of each config" />
        </section>
      ) : null}

      <section aria-labelledby="evals-judge" className="space-y-3">
        <h2 id="evals-judge" className="text-title font-semibold">
          Judge agreement
        </h2>
        <JudgeAgreement calibration={calibration} />
      </section>

      <section aria-labelledby="evals-runs" className="space-y-3">
        <h2 id="evals-runs" className="text-title font-semibold">
          All runs
        </h2>
        <RunsTable runs={[...runs].reverse()} caption="Every run, newest first" />
      </section>
    </main>
  );
}
