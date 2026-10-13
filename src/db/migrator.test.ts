import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyMigrations, MIGRATIONS_FOLDER } from "./migrator";

// A rebuild of `chats` exactly as drizzle-kit emits one for an FK/constraint change: the PRAGMAs
// sit inside the migration, which is what made them no-ops under drizzle's transaction.
const REBUILD_CHATS = [
  "PRAGMA foreign_keys=OFF;",
  `CREATE TABLE \`__new_chats\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`title\` text DEFAULT 'New chat' NOT NULL,
	\`pinned\` integer DEFAULT false NOT NULL,
	\`created_at\` integer NOT NULL,
	\`updated_at\` integer NOT NULL,
	\`last_message_at\` integer,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
);`,
  `INSERT INTO \`__new_chats\`("id", "user_id", "title", "pinned", "created_at", "updated_at", "last_message_at") SELECT "id", "user_id", "title", "pinned", "created_at", "updated_at", "last_message_at" FROM \`chats\`;`,
  "DROP TABLE `chats`;",
  "ALTER TABLE `__new_chats` RENAME TO `chats`;",
  "PRAGMA foreign_keys=ON;",
  "CREATE INDEX `chats_user_updated_idx` ON `chats` (`user_id`,`updated_at`);",
].join("--> statement-breakpoint\n");

// The search triggers read `chats`, so a rebuild of it drops them first and recreates them after, as a real one must.
function rebuildChats(): string {
  const triggers = sqlite.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql LIKE '%chats%'").all() as { name: string; sql: string }[];
  return [...triggers.map((t) => `DROP TRIGGER \`${t.name}\`;`), REBUILD_CHATS, ...triggers.map((t) => `${t.sql};`)].join("--> statement-breakpoint\n");
}

let dir: string;
let sqlite: Database.Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-migrator-"));
  sqlite = new Database(path.join(dir, "app.db"));
  sqlite.pragma("foreign_keys = ON");
});

afterEach(() => {
  sqlite.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** The real migrations plus one extra, in a temp folder with its own journal. */
function withExtraMigration(sql: string): string {
  const folder = path.join(dir, "migrations");
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
  };
  const last = journal.entries[journal.entries.length - 1]!;
  journal.entries.push({ idx: last.idx + 1, version: last.version, when: last.when + 1000, tag: "9999_test_extra", breakpoints: true });
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  fs.writeFileSync(path.join(folder, "9999_test_extra.sql"), sql);
  return folder;
}

function seed(): void {
  const t = Date.now();
  sqlite
    .prepare("INSERT INTO users (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("u1", "u1", "u1@example.com", t, t);
  sqlite.prepare("INSERT INTO chats (id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)").run("c1", "u1", t, t);
  sqlite
    .prepare("INSERT INTO messages (id, chat_id, role, position, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("m1", "c1", "user", 0, "[]", t, t);
  sqlite
    .prepare(
      "INSERT INTO generations (id, chat_id, user_id, message_id, user_message_id, requested_model, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("g1", "c1", "u1", "m2", "m1", "test-model", t);
}

/** The real migrations up to and including `tag`, as a database that last booted then has them. */
function migrationsThrough(tag: string): string {
  const folder = path.join(dir, `through-${tag}`);
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  journal.entries = journal.entries.slice(0, journal.entries.findIndex((e) => e.tag === tag) + 1);
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  return folder;
}

const count = (table: string) => sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
const journalRows = () => count("__drizzle_migrations");

describe("applyMigrations", () => {
  it("rebuilds a parent table without cascading into its children", () => {
    applyMigrations(sqlite);
    seed();
    applyMigrations(sqlite, withExtraMigration(rebuildChats()));

    expect(count("chats")).toBe(1);
    expect(count("messages")).toBe(1);
    expect(count("generations")).toBe(1);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
    // The rebuilt table enforces its FKs again: an orphan chat is refused.
    expect(() =>
      sqlite.prepare("INSERT INTO chats (id, user_id, created_at, updated_at) VALUES ('c2', 'nobody', 0, 0)").run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it("drizzle's own migrator cascades the same rebuild into the children (why it is replaced)", () => {
    applyMigrations(sqlite);
    seed();
    migrate(drizzle(sqlite), { migrationsFolder: withExtraMigration(rebuildChats()) });

    expect(count("chats")).toBe(1);
    expect(count("messages")).toBe(0);
    expect(count("generations")).toBe(0);
  });

  it("rolls back a migration that leaves a dangling foreign key", () => {
    applyMigrations(sqlite);
    seed();
    const before = journalRows();

    expect(() => applyMigrations(sqlite, withExtraMigration("DELETE FROM `users`;"))).toThrow(
      /migrations rolled back: \d+ foreign key violation/,
    );
    expect(count("users")).toBe(1);
    expect(journalRows()).toBe(before);
    expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("shares drizzle's journal: either runner picks up where the other left off", () => {
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
    const applied = journalRows();
    applyMigrations(sqlite);
    expect(journalRows()).toBe(applied);

    applyMigrations(sqlite, withExtraMigration("CREATE TABLE `extra` (`id` text PRIMARY KEY NOT NULL);"));
    expect(journalRows()).toBe(applied + 1);
    migrate(drizzle(sqlite), { migrationsFolder: withExtraMigration("CREATE TABLE `extra` (`id` text PRIMARY KEY NOT NULL);") });
    expect(journalRows()).toBe(applied + 1);
  });
});

// One initial migration: the schema, plus the search index and its triggers, which drizzle-kit cannot express.
describe("the initial migration", () => {
  it("builds the whole schema with the search index and its triggers in one step", () => {
    applyMigrations(sqlite, migrationsThrough("0000_init"));
    expect(journalRows()).toBe(1);
    const chatColumns = (sqlite.pragma("table_info(chats)") as { name: string }[]).map((c) => c.name);
    expect(chatColumns).toEqual(expect.arrayContaining(["forked_from", "fork_position", "fork_order", "tab_hidden", "pinned"]));
    const messageColumns = (sqlite.pragma("table_info(messages)") as { name: string }[]).map((c) => c.name);
    expect(messageColumns).toEqual(expect.arrayContaining(["thinking", "fork_options", "search_text", "last_seq"]));
    const userColumns = (sqlite.pragma("table_info(users)") as { name: string }[]).map((c) => c.name);
    expect(userColumns).toEqual(expect.arrayContaining(["explore_options", "is_anonymous", "budget_keys"]));
    expect(count("spend_buckets")).toBe(0);
    expect(count("instance_settings")).toBe(0);
    seed();
    sqlite.prepare("UPDATE messages SET content = ? WHERE id = 'm1'").run(JSON.stringify([{ type: "text", text: "quokka sightings" }]));
    expect(sqlite.prepare("SELECT search_text FROM messages WHERE id = 'm1'").pluck().get()).toBe("quokka sightings");
    expect(sqlite.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'quokka'").all()).toHaveLength(1);
    sqlite.prepare("DELETE FROM chats WHERE id = 'c1'").run();
    expect(count("messages")).toBe(0);
    expect(sqlite.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'quokka'").all()).toHaveLength(0);
    // Applying again is a no-op.
    applyMigrations(sqlite, migrationsThrough("0000_init"));
    expect(journalRows()).toBe(1);
  });
});

describe("the search owner migration", () => {
  const text = (t: string) => JSON.stringify([{ type: "text", text: t }]);
  const owned = (owner: string, term: string) =>
    sqlite.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?").all(`search_owner:${Buffer.from(owner).toString("hex")} AND ${term}`).length;
  const integrityCheck = () => sqlite.prepare("INSERT INTO messages_fts(messages_fts, rank) VALUES ('integrity-check', 1)").run();

  it("backfills existing messages into the owner-keyed index, and its triggers keep it in step", () => {
    applyMigrations(sqlite, migrationsThrough("0000_init"));
    seed();
    sqlite.prepare("UPDATE messages SET content = ? WHERE id = 'm1'").run(text("quokka sightings"));
    applyMigrations(sqlite);

    expect(sqlite.prepare("SELECT search_owner FROM messages WHERE id = 'm1'").pluck().get()).toBe("7531");
    expect(owned("u1", "quokka")).toBe(1);
    expect(owned("u1", '"quo"*')).toBe(1);
    integrityCheck();

    sqlite.prepare("INSERT INTO users (id, name, email, created_at, updated_at) VALUES ('u2', 'u2', 'u2@example.com', 0, 0)").run();
    sqlite.prepare("INSERT INTO messages (id, chat_id, role, position, content, created_at, updated_at) VALUES ('m2', 'c1', 'assistant', 1, ?, 0, 0)").run(text("wombat burrows"));
    expect(owned("u1", "wombat")).toBe(1);
    sqlite.prepare("UPDATE messages SET content = ? WHERE id = 'm2'").run(text("numbat termites"));
    expect(owned("u1", "wombat")).toBe(0);
    expect(owned("u1", "numbat")).toBe(1);
    // A guest's chats adopted by a new account move with their messages in the index.
    sqlite.prepare("UPDATE chats SET user_id = 'u2' WHERE id = 'c1'").run();
    expect(owned("u1", "quokka")).toBe(0);
    expect(owned("u2", "quokka")).toBe(1);
    integrityCheck();

    sqlite.prepare("DELETE FROM chats WHERE id = 'c1'").run();
    expect(sqlite.prepare("SELECT count(*) FROM messages_fts WHERE messages_fts MATCH 'quokka OR numbat'").pluck().get()).toBe(0);
    integrityCheck();
  });
});
