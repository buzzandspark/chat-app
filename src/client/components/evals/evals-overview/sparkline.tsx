const W = 120;
const H = 32;
const PAD = 4;

/** One metric across production runs, oldest to newest; each point's title gives its run and value. Nothing for a single run. */
export function Sparkline({ points, label }: { points: { value: number; title: string }[]; label: string }) {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const xy = points.map((p, i) => ({
    ...p,
    x: PAD + (i / (points.length - 1)) * (W - 2 * PAD),
    y: H - PAD - ((p.value - min) / span) * (H - 2 * PAD),
  }));
  const last = xy.at(-1);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="text-chart-1" role="img" aria-label={`${label} across production runs`}>
      <polyline points={xy.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {last ? <circle cx={last.x} cy={last.y} r={4} fill="currentColor" stroke="var(--background)" strokeWidth={2} /> : null}
      {xy.map((p) => (
        <circle key={p.title} cx={p.x} cy={p.y} r={8} fill="transparent">
          <title>{p.title}</title>
        </circle>
      ))}
    </svg>
  );
}
