export function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

/** Nearest-rank percentile; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null;
}

/** Agreement between two raters beyond what their yes-rates would give by chance: 1 is perfect, 0 is chance. Null when chance agreement is already total. */
export function cohensKappa(pairs: readonly (readonly [boolean, boolean])[]): number | null {
  if (pairs.length === 0) return null;
  const n = pairs.length;
  const observed = pairs.filter(([a, b]) => a === b).length / n;
  const yesA = pairs.filter(([a]) => a).length / n;
  const yesB = pairs.filter(([, b]) => b).length / n;
  const chance = yesA * yesB + (1 - yesA) * (1 - yesB);
  return chance === 1 ? null : (observed - chance) / (1 - chance);
}
