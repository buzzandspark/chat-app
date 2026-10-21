import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { sampleCorrect, type CaseResult, type SampleResult } from "@shared/evals";

export interface CaseRow {
  result: CaseResult;
  baseline: CaseResult | null;
  question: string | null;
  reply: string | null;
}

function Mark({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? Check : X;
  return (
    <span className={cn("inline-flex items-center gap-0.5", ok ? "text-success" : "text-destructive")}>
      <Icon className="size-3.5" aria-hidden />
      <span className="text-foreground">{label}</span>
    </span>
  );
}

function Sample({ sample, index, gold }: { sample: SampleResult; index: number; gold: CaseResult["gold"] }) {
  const correct = sampleCorrect(gold, sample);
  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
        <Mark ok={correct} label={`Sample ${index + 1}`} />
        <span className="text-muted-foreground">
          {sample.options.length >= 2 ? `${sample.options.length} options` : "no button"}
          {sample.count !== null ? ` · streamed count ${sample.count}` : ""}
          {sample.error ? ` · error: ${sample.error}` : !sample.parsed ? " · unparsable answer" : ""}
        </span>
      </div>
      {sample.options.length >= 2 ? (
        <ol className="space-y-2">
          {sample.options.map((o, i) => {
            const v = sample.judge?.options[i];
            return (
              <li key={`${o.title}-${i}`} className="space-y-0.5 text-small">
                <div className="font-medium">{o.title}</div>
                <div className="text-foreground/90">{o.prompt}</div>
                {v ? (
                  <div className="flex flex-wrap gap-x-3 text-caption">
                    <Mark ok={v.faithful} label="faithful" />
                    <Mark ok={v.standalone} label="standalone" />
                    <Mark ok={v.concrete} label="concrete" />
                    <span className="basis-full text-muted-foreground">{v.reasoning}</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}
      {sample.judge ? (
        <div className="text-caption">
          <Mark ok={sample.judge.coverage} label="coverage" /> <span className="text-muted-foreground">{sample.judge.coverageReasoning}</span>
        </div>
      ) : null}
    </div>
  );
}

function Marks({ result }: { result: CaseResult }) {
  return (
    <span className="inline-flex gap-0.5" aria-label={`${result.samples.filter((s) => sampleCorrect(result.gold, s)).length} of ${result.samples.length} samples right`}>
      {result.samples.map((s, i) => {
        const Icon = sampleCorrect(result.gold, s) ? Check : X;
        return <Icon key={i} className={cn("size-3.5", sampleCorrect(result.gold, s) ? "text-success" : "text-destructive")} aria-hidden />;
      })}
    </span>
  );
}

function Case({ row }: { row: CaseRow }) {
  const { result, baseline } = row;
  const gold = result.gold;
  return (
    <details className="group border-t border-border">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 py-2 text-small">
        <span className="font-medium">{result.id}</span>
        <Marks result={result} />
        {baseline ? (
          <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
            baseline <Marks result={baseline} />
          </span>
        ) : null}
        <span className="text-caption text-muted-foreground">{gold.hasChoice ? `choice of ${gold.count}` : "no choice"}</span>
        <span className="text-caption text-muted-foreground">{result.tags.join(", ")}</span>
      </summary>
      <div className="space-y-3 pb-4">
        {gold.hasChoice ? <p className="text-small">Labeled options: {gold.titles.join(" · ")}</p> : null}
        {row.question ? <p className="text-small text-muted-foreground">Asked: {row.question}</p> : null}
        <div className="max-h-80 overflow-y-auto rounded-md bg-muted p-3 font-mono text-caption whitespace-pre-wrap">{row.reply ?? "This reply is no longer in the dataset."}</div>
        <div className="grid gap-3 md:grid-cols-2">
          {result.samples.map((s, i) => (
            <Sample key={i} sample={s} index={i} gold={gold} />
          ))}
        </div>
        {baseline ? (
          <div className="space-y-2">
            <div className="text-caption text-muted-foreground">Baseline answers</div>
            <div className="grid gap-3 md:grid-cols-2">
              {baseline.samples.map((s, i) => (
                <Sample key={i} sample={s} index={i} gold={baseline.gold} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </details>
  );
}

export function CaseList({ title, rows, empty }: { title: string; rows: CaseRow[]; empty?: string }) {
  if (rows.length === 0 && !empty) return null;
  return (
    <section className="space-y-1">
      <h3 className="text-small font-semibold">
        {title} <span className="font-normal text-muted-foreground">({rows.length})</span>
      </h3>
      {rows.length === 0 ? <p className="text-small text-muted-foreground">{empty}</p> : rows.map((row) => <Case key={row.result.id} row={row} />)}
    </section>
  );
}
