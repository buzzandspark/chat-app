/** Runs `work` over `items` with at most `limit` in flight, keeping the input order. */
export async function pool<T, R>(items: readonly T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  // One iterator shared by every worker, so each item is taken once.
  const entries = items.entries();
  const worker = async () => {
    for (const [i, item] of entries) results[i] = await work(item, i);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function flag(args: readonly string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
}
