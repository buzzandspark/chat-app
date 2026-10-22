import { ArrowDown, ArrowUp } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { Reply } from "@server/evals";
import { sampleCorrect, type CaseResult, type RunFile } from "@shared/evals";
import { METRICS, formatChange, formatDate, formatValue, improvement } from "../format";
import { CaseList, type CaseRow } from "./case-list";

// Rendered by the server page only: no client JS.

const score = (c: CaseResult) => c.samples.filter((s) => sampleCorrect(c.gold, s)).length / (c.samples.length || 1);
const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

function Change({ value, text }: { value: number | null; text: string }) {
  if (value === null || Math.abs(value) < 1e-9) return <span className="text-muted-foreground">{text || "–"}</span>;
  const Icon = value > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={cn("inline-flex items-center gap-0.5", value > 0 ? "text-success" : "text-destructive")}>
      <Icon className="size-3.5" aria-label={value > 0 ? "better" : "worse"} />
      <span className="text-foreground">{text}</span>
    </span>
  );
}

/** One run: its numbers next to its baseline's, accuracy by tag, and every case, the ones that changed first. */
export function RunDetail({ run, baseline, replies }: { run: RunFile; baseline: RunFile | null; replies: Map<string, Reply> }) {
  const before = new Map(baseline?.cases.map((c) => [c.id, c]));
  const rows: CaseRow[] = run.cases.map((result) => ({ result, baseline: before.get(result.id) ?? null, question: replies.get(result.id)?.question ?? null, reply: replies.get(result.id)?.reply ?? null }));
  const scored = rows.filter((r) => !r.result.ambiguous);
  const delta = (r: CaseRow) => (r.baseline ? score(r.result) - score(r.baseline) : 0);
  const worse = scored.filter((r) => delta(r) < 0).sort((a, b) => delta(a) - delta(b));
  const better = scored.filter((r) => delta(r) > 0).sort((a, b) => delta(b) - delta(a));
  const wrong = scored.filter((r) => delta(r) === 0 && score(r.result) < 1);
  const right = scored.filter((r) => delta(r) === 0 && score(r.result) === 1);
  const tags = Object.entries(run.byTag).sort(([, a], [, b]) => b.cases - a.cases);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-8 px-4 pt-8 pb-[max(2rem,env(safe-area-inset-bottom,0px))]">
      <Link href="/evals" className="text-small text-muted-foreground underline-offset-2 hover:underline">
        ← All runs
      </Link>
      <header className="space-y-2">
        <h1 className="text-display font-semibold">{run.config.name}</h1>
        {run.note ? <p className="text-body text-muted-foreground">{run.note}</p> : null}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-small sm:grid-cols-3">
          {[
            ["Model", `${run.config.model}, effort ${run.config.effort}, thinking ${run.config.thinking}`],
            ["Run", `${run.id}, ${formatDate(run.createdAt)}`],
            ["Samples", `${run.samples} per reply, ${run.cases.length} replies`],
            ["Config", run.config.hash],
            ["Dataset", run.datasetHash],
            ["Cost", `$${run.costUsd.detect.toFixed(2)} detection + $${run.costUsd.judge.toFixed(2)} judge (${run.judgeModel})`],
          ].map(([term, value]) => (
            <div key={term}>
              <dt className="text-caption text-muted-foreground">{term}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <section aria-labelledby="run-metrics" className="space-y-2">
        <h2 id="run-metrics" className="text-title font-semibold">
          Metrics
        </h2>
        {baseline ? (
          <p className="text-small text-muted-foreground">
            Compared with <Link href={`/evals/${baseline.id}`} prefetch={false} className="underline underline-offset-2">{baseline.id}</Link>
            {baseline.datasetHash !== run.datasetHash ? ", which ran on a different dataset" : ""}
            {baseline.judgeVersion !== run.judgeVersion ? ", graded under a different judge version" : ""}.
          </p>
        ) : null}
        <div tabIndex={0} className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[560px] border-collapse text-small">
            <thead>
              <tr className="text-caption text-muted-foreground">
                <th scope="col" className="pb-1 text-left font-normal">
                  Metric
                </th>
                <th scope="col" className="pb-1 pl-3 text-right font-normal">
                  This run
                </th>
                <th scope="col" className="pb-1 pl-3 text-right font-normal">
                  Held-out split
                </th>
                {baseline ? (
                  <>
                    <th scope="col" className="pb-1 pl-3 text-right font-normal">
                      Baseline
                    </th>
                    <th scope="col" className="pb-1 pl-3 text-right font-normal">
                      Change
                    </th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.key} className="border-t border-border">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    <div>{m.label}</div>
                    <div className="text-caption text-muted-foreground">{m.hint}</div>
                  </th>
                  <td className="py-1.5 pl-3 text-right font-medium tabular-nums">{formatValue(run.summary[m.key], m.format)}</td>
                  <td className="py-1.5 pl-3 text-right text-muted-foreground tabular-nums">{formatValue(run.bySplit.test?.[m.key] ?? null, m.format)}</td>
                  {baseline ? (
                    <>
                      <td className="py-1.5 pl-3 text-right tabular-nums">{formatValue(baseline.summary[m.key], m.format)}</td>
                      <td className="py-1.5 pl-3 text-right tabular-nums">
                        <Change value={improvement(m.key, baseline.summary[m.key], run.summary[m.key])} text={formatChange(m, baseline.summary[m.key], run.summary[m.key])} />
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="run-tags" className="space-y-2">
        <h2 id="run-tags" className="text-title font-semibold">
          By kind of reply
        </h2>
        <p className="text-small text-muted-foreground">Samples with the right button and option count, by the tags in the labeling guide.</p>
        <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
          {tags.map(([tag, t]) => {
            const b = baseline?.byTag[tag];
            return (
              <div key={tag} className="flex items-baseline justify-between gap-3 border-t border-border py-1.5 text-small">
                <span>{tag}</span>
                <span className="tabular-nums">
                  {pct(t.correct / t.cases)} <span className="text-caption text-muted-foreground">of {t.cases}</span>
                  {b ? <span className="pl-2 text-caption text-muted-foreground">was {pct(b.correct / b.cases)}</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="run-cases" className="space-y-5">
        <h2 id="run-cases" className="text-title font-semibold">
          Cases
        </h2>
        {baseline ? (
          <>
            <CaseList title="Worse than the baseline" rows={worse} empty="None." />
            <CaseList title="Better than the baseline" rows={better} empty="None." />
          </>
        ) : null}
        <CaseList title={baseline ? "Still wrong in some samples" : "Wrong in some samples"} rows={wrong} />
        <CaseList title="Right in every sample" rows={right} />
        <CaseList title="Ambiguous, not scored" rows={rows.filter((r) => r.result.ambiguous)} />
      </section>
    </main>
  );
}
