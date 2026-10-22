import fs from "node:fs";
import path from "node:path";
import type { z } from "zod";
import { sha256 } from "./cases";

const CACHE_DIR = path.resolve("evals/.cache");

/** Content-addressed: the key hashes every input that could change the answer, so a rerun of unchanged inputs makes no API call. `keep` decides what's worth storing. */
export async function cached<T extends z.ZodType>(
  kind: string,
  key: unknown,
  schema: T,
  compute: () => Promise<z.infer<T>>,
  keep: (value: z.infer<T>) => boolean = () => true,
): Promise<{ value: z.infer<T>; hit: boolean }> {
  const hash = sha256(key);
  const file = path.join(CACHE_DIR, kind, hash.slice(0, 2), `${hash}.json`);
  if (fs.existsSync(file)) {
    const result = schema.safeParse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (result.success) return { value: result.data, hit: true };
  }
  const value = await compute();
  if (!keep(value)) return { value, hit: false };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return { value, hit: false };
}
