import { tokenize } from "./highlight-core";

/** D15: tokenising a 600-line block takes about 1.8 s on a throttled phone; it happens here, off the main thread. */
interface Job {
  id: number;
  code: string;
  lang: string;
}

self.onmessage = async (event: MessageEvent<Job>) => {
  const { id, code, lang } = event.data;
  try {
    const lines = await tokenize(code, lang);
    self.postMessage({ id, lines });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
