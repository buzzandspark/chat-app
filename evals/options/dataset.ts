// Builds the dataset: `import <db…>` and `generate` collect replies into data/inbox.jsonl, `prelabel` drafts their labels with Opus into data/cases.jsonl.
// Usage: pnpm evals:data import data/app.db | generate | prelabel
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import Database from "better-sqlite3";
import { z } from "zod";
import { SYSTEM_PROMPT } from "@relay/anthropic/system-prompt";
import { CASES_PATH, DATA_DIR, OPTIONS_DIR, datasetHash, loadCases, readJsonl, splitOf, writeJsonl, Case } from "./cases";
import { pool } from "./pool";

const INBOX_PATH = path.join(DATA_DIR, "inbox.jsonl");
const SEEDS_PATH = path.join(DATA_DIR, "seeds.jsonl");
const OPUS = "claude-opus-5-5";

const InboxItem = Case.pick({ id: true, source: true, question: true, reply: true, tags: true });
type InboxItem = z.infer<typeof InboxItem>;
const Seed = z.object({ id: z.string(), question: z.string(), tags: z.array(z.string()) });

const Draft = z.object({
  reasoning: z.string(),
  hasChoice: z.boolean(),
  count: z.number().int(),
  titles: z.array(z.string()),
  ambiguous: z.boolean(),
  tags: z.array(z.string()),
});

const textOf = (content: string): string =>
  z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .parse(JSON.parse(content))
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");

/** Logs a failed call and returns null, so one failure doesn't discard the other items' paid calls. */
function orNull<T extends { id: string }, R>(work: (item: T) => Promise<R>): (item: T) => Promise<R | null> {
  return (item) =>
    work(item).catch((err: unknown) => {
      console.error(`\n${item.id}: ${String(err)}`);
      return null;
    });
}

function known(): Set<string> {
  return new Set([...loadCases().map((c) => c.reply.trim()), ...readJsonl(INBOX_PATH, InboxItem).map((i) => i.reply.trim())]);
}

function append(items: InboxItem[]): void {
  writeJsonl(INBOX_PATH, [...readJsonl(INBOX_PATH, InboxItem), ...items]);
  console.log(`${items.length} new replies in ${path.relative(process.cwd(), INBOX_PATH)}; read them for anything private before labeling, since cases are committed.`);
}

/** Finished live replies from app databases. The user's own messages stay out: cases are committed and shown on /evals. */
function importDbs(files: string[]): void {
  const seen = known();
  const items: InboxItem[] = [];
  for (const file of files) {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = z
      .array(z.object({ id: z.string(), content: z.string() }))
      .parse(
        db
          .prepare(
            `SELECT m.id, m.content FROM messages m JOIN generations g ON g.id = m.generation_id
             WHERE m.role = 'assistant' AND m.status = 'done' AND g.provider = 'anthropic' ORDER BY m.created_at`,
          )
          .all(),
      );
    for (const row of rows) {
      const reply = textOf(row.content).trim();
      if (!reply || seen.has(reply)) continue;
      seen.add(reply);
      items.push({ id: `local-${row.id.slice(-12)}`, source: "local", question: null, reply, tags: [] });
    }
    db.close();
  }
  append(items);
}

/** Opus answers each seed question under the app's own system prompt, so the replies read like real ones. */
async function generate(client: Anthropic): Promise<void> {
  const seen = new Set([...loadCases().map((c) => c.id), ...readJsonl(INBOX_PATH, InboxItem).map((i) => i.id)]);
  const seeds = readJsonl(SEEDS_PATH, Seed).filter((s) => !seen.has(`syn-${s.id}`));
  const items = await pool(seeds, 6, orNull(async (seed) => {
    const message = await client.messages.create({
      model: OPUS,
      max_tokens: 16_000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: seed.question }],
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });
    const reply = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    process.stdout.write(".");
    return { id: `syn-${seed.id}`, source: "synthetic" as const, question: seed.question, reply, tags: seed.tags };
  }));
  append(items.filter((i) => i !== null).filter((i) => i.reply.trim()));
}

/** Drafts each inbox reply's label against GUIDE.md; a person reviews the drafts with `pnpm evals:label cases`. */
async function prelabel(client: Anthropic): Promise<void> {
  const guide = fs.readFileSync(path.join(OPTIONS_DIR, "GUIDE.md"), "utf8");
  const inbox = readJsonl(INBOX_PATH, InboxItem);
  const drafted = await pool(inbox, 6, orNull(async (item): Promise<Case> => {
    const message = await client.messages.parse({
      model: OPUS,
      max_tokens: 8192,
      system: `You label replies for an evaluation dataset, following this guide exactly.\n\n${guide}`,
      messages: [{ role: "user", content: `<reply>\n${item.reply}\n</reply>` }],
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: zodOutputFormat(Draft) },
    });
    const draft = message.parsed_output;
    if (!draft) throw new Error(`No label for ${item.id}`);
    process.stdout.write(".");
    return {
      id: item.id,
      source: item.source,
      split: splitOf(item.id),
      tags: [...new Set([...item.tags, ...draft.tags])],
      question: item.question,
      reply: item.reply,
      gold: draft.hasChoice ? { hasChoice: true, count: draft.count, titles: draft.titles } : { hasChoice: false, count: 0, titles: [] },
      ambiguous: draft.ambiguous,
      reviewed: false,
      notes: `${OPUS} draft: ${draft.reasoning}`,
    };
  }));
  const done = drafted.filter((d) => d !== null);
  writeJsonl(CASES_PATH, [...loadCases(), ...done]);
  writeJsonl(INBOX_PATH, inbox.filter((_, i) => drafted[i] === null));
  console.log(`\n${done.length} drafts added to ${path.relative(process.cwd(), CASES_PATH)}`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const client = new Anthropic({ maxRetries: 5 });
  if (command === "import") importDbs(rest);
  else if (command === "generate") await generate(client);
  else if (command === "prelabel") await prelabel(client);
  else throw new Error("Usage: pnpm evals:data import <db…> | generate | prelabel");
  console.log(`${loadCases().length} cases, dataset ${datasetHash(loadCases())}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
