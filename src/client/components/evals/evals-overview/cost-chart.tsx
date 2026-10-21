import type { RunFile } from "@shared/evals";
import { formatValue } from "../format";

const W = 640;
const H = 300;
const M = { top: 16, right: 24, bottom: 44, left: 52 };

const LABEL_H = 15;
const LABEL_W = 90;

/** Labels sit right of their point; one that would overlap a label already placed moves down until it doesn't. */
function placeLabels<T extends { cx: number; cy: number }>(points: T[]): (T & { ly: number })[] {
  const placed: (T & { ly: number })[] = [];
  for (const p of [...points].sort((a, b) => a.cy - b.cy)) {
    let ly = p.cy;
    while (placed.some((q) => Math.abs(q.ly - ly) < LABEL_H && Math.abs(q.cx - p.cx) < LABEL_W)) ly += LABEL_H;
    placed.push({ ...p, ly });
  }
  return placed;
}

/** Detection F1 against cost per 1k replies (log scale), one point per config; up and to the left is better. */
export function CostChart({ runs }: { runs: RunFile[] }) {
  const points = runs.filter((r) => r.summary.f1 !== null && r.summary.costPer1k > 0).sort((a, b) => a.summary.costPer1k - b.summary.costPer1k);
  if (points.length === 0) return null;
  const costs = points.map((r) => Math.log10(r.summary.costPer1k));
  const xMin = Math.floor(Math.min(...costs) * 2) / 2;
  const xTop = Math.ceil(Math.max(...costs) * 2) / 2;
  const xMax = xTop > xMin ? xTop : xMin + 0.5;
  const f1s = points.map((r) => r.summary.f1 ?? 0);
  const yMin = Math.max(0, Math.floor((Math.min(...f1s) - 0.02) * 20) / 20);
  const yMax = Math.min(1, Math.ceil((Math.max(...f1s) + 0.02) * 20) / 20);
  const x = (cost: number) => M.left + ((Math.log10(cost) - xMin) / (xMax - xMin || 1)) * (W - M.left - M.right);
  const y = (f1: number) => H - M.bottom - ((f1 - yMin) / (yMax - yMin || 1)) * (H - M.top - M.bottom);
  const xTicks = [0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 3, 5, 10, 20, 30, 50].filter((t) => Math.log10(t) >= xMin && Math.log10(t) <= xMax);
  const yTicks = Array.from({ length: Math.round((yMax - yMin) / 0.05) + 1 }, (_, i) => yMin + i * 0.05);

  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[560px]" role="img" aria-label="Detection F1 against cost per thousand replies, one point per config">
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[11px] tabular-nums">
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - M.bottom + 18} textAnchor="middle" className="fill-muted-foreground text-[11px] tabular-nums">
            ${t}
          </text>
        ))}
        <text x={(M.left + W - M.right) / 2} y={H - 6} textAnchor="middle" className="fill-muted-foreground text-[11px]">
          Cost per 1k replies (log scale)
        </text>
        <text x={14} y={(M.top + H - M.bottom) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(M.top + H - M.bottom) / 2})`} className="fill-muted-foreground text-[11px]">
          Detection F1
        </text>
        {placeLabels(points.map((r) => ({ r, cx: x(r.summary.costPer1k), cy: y(r.summary.f1 ?? 0) }))).map(({ r, cx, cy, ly }) => {
          const production = r.config.name === "production";
          return (
            <g key={r.id}>
              <circle cx={cx} cy={cy} r={6} className={production ? "fill-chart-1" : "fill-muted-foreground"} stroke="var(--background)" strokeWidth={2} />
              <text x={cx + 11} y={ly} dy="0.32em" className="fill-foreground text-[12px] font-medium">
                {r.config.name}
              </text>
              <circle cx={cx} cy={cy} r={14} fill="transparent">
                <title>
                  {`${r.config.name} (${r.config.model}, ${r.config.effort})\nF1 ${formatValue(r.summary.f1, "pct")} · prompts pass ${formatValue(r.summary.promptPass, "pct")}\n${formatValue(r.summary.costPer1k, "usd")} per 1k · count p95 ${formatValue(r.summary.countMsP95, "ms")}`}
                </title>
              </circle>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
