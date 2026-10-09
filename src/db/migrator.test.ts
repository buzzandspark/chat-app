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

let dir: string;
let sqlite: Database.Database;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "cadence-migrator-"));
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

const count = (table: string) => sqlite.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;
const journalRows = () => count("__drizzle_migrations");

describe("applyMigrations", () => {
  it("rebuilds a parent table without cascading into its children", () => {
    applyMigrations(sqlite);
    seed();
    applyMigrations(sqlite, withExtraMigration(REBUILD_CHATS));

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
    migrate(drizzle(sqlite), { migrationsFolder: withExtraMigration(REBUILD_CHATS) });

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

// Chat groups came in with 0008 and left with 0010. 0008 as first committed (d1f1728) had `group_id` with a
// bare REFERENCES; it was later edited in place to add ON DELETE SET NULL, which 0009 converged on by
// rebuilding `chats`. 0010 drops the table and the column; every path through those migrations must
// arrive at the same schema with every chat, message and generation kept.
const ORIGINAL_0008 = `CREATE TABLE \`chat_groups\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`user_id\` text NOT NULL,
	\`name\` text NOT NULL,
	\`position\` integer DEFAULT 0 NOT NULL,
	\`collapsed\` integer DEFAULT false NOT NULL,
	\`created_at\` integer NOT NULL,
	FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`chat_groups_user_idx\` ON \`chat_groups\` (\`user_id\`,\`position\`);--> statement-breakpoint
ALTER TABLE \`chats\` ADD \`group_id\` text REFERENCES chat_groups(id);`;

/** The real migrations up to and including `last`, optionally with 0008 as it was first committed. */
function migrationsThrough(last: number, original0008 = false): string {
  const folder = path.join(dir, `migrations-${last}${original0008 ? "-original" : ""}`);
  fs.cpSync(MIGRATIONS_FOLDER, folder, { recursive: true });
  const journalPath = path.join(folder, "meta/_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as { entries: { idx: number; tag: string }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= last);
  expect(journal.entries[8]!.tag).toBe("0008_brave_mister_fear");
  fs.writeFileSync(journalPath, JSON.stringify(journal));
  if (original0008) fs.writeFileSync(path.join(folder, "0008_brave_mister_fear.sql"), ORIGINAL_0008);
  return folder;
}

/** Every schema object except drizzle's own journal, for comparing two databases. */
const schemaObjects = (db: Database.Database) =>
  db
    .prepare(`SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name <> '__drizzle_migrations' ORDER BY type, name`)
    .all();

const hasTable = (name: string) =>
  sqlite.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?").pluck().get(name) === 1;
const chatColumns = () => (sqlite.pragma("table_info(chats)") as { name: string }[]).map((c) => c.name);

function seedGrouped(): void {
  const t = Date.now();
  sqlite
    .prepare("INSERT INTO users (id, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("u1", "u1", "u1@example.com", t, t);
  sqlite
    .prepare("INSERT INTO chat_groups (id, user_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("grp1", "u1", "Work", 0, t);
  const chat = sqlite.prepare(
    "INSERT INTO chats (id, user_id, title, pinned, group_id, created_at, updated_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  chat.run("c1", "u1", "Grouped", 0, "grp1", t, t + 1, t + 2);
  chat.run("c2", "u1", "Pinned", 1, null, t, t + 3, null);
  const message = sqlite.prepare(
    "INSERT INTO messages (id, chat_id, role, position, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  message.run("m1", "c1", "user", 0, JSON.stringify([{ type: "text", text: "quokka sightings" }]), t, t);
  message.run("m2", "c2", "user", 0, JSON.stringify([{ type: "text", text: "hello" }]), t, t);
  sqlite
    .prepare(
      "INSERT INTO generations (id, chat_id, user_id, message_id, user_message_id, requested_model, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run("g1", "c1", "u1", "m3", "m1", "test-model", t);
}

const CHAT_FIELDS = "id, user_id, title, pinned, created_at, updated_at, last_message_at";

/** After 0010: no groups anywhere, every row kept, search and FKs working, the schema of a fresh database. */
function expectGroupsGoneRowsKept(chatsBefore: unknown[]): void {
  expect(journalRows()).toBe(12);
  expect(hasTable("chat_groups")).toBe(false);
  expect(chatColumns()).not.toContain("group_id");
  expect(sqlite.prepare(`SELECT ${CHAT_FIELDS} FROM chats ORDER BY id`).all()).toEqual(chatsBefore);
  expect(count("messages")).toBe(2);
  expect(count("generations")).toBe(1);
  expect(
    sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'chats' ORDER BY name").pluck().all(),
  ).toEqual(["chats_forked_from_idx", "chats_user_updated_idx", "sqlite_autoindex_chats_1"]);
  // Search (FTS5 over messages, kept by triggers) is untouched by the rebuilds.
  expect(sqlite.prepare("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'quokka'").all()).toHaveLength(1);
  expect(sqlite.pragma("foreign_keys", { simple: true })).toBe(1);
  // Deleting a chat still cascades into its messages: the rebuilt table kept its FKs.
  sqlite.prepare("DELETE FROM chats WHERE id = 'c1'").run();
  expect(count("messages")).toBe(1);

  const fresh = new Database(path.join(dir, "fresh.db"));
  try {
    applyMigrations(fresh);
    expect(schemaObjects(sqlite)).toEqual(schemaObjects(fresh));
  } finally {
    fresh.close();
  }
}

describe("migrations 0009 and 0010 (chat groups repaired, then removed)", () => {
  it("a database that ran the original 0008 loses its groups and keeps every row", () => {
    applyMigrations(sqlite, migrationsThrough(8, true));
    seedGrouped();
    const chatsBefore = sqlite.prepare(`SELECT ${CHAT_FIELDS} FROM chats ORDER BY id`).all();

    applyMigrations(sqlite);
    expectGroupsGoneRowsKept(chatsBefore);
  });

  it("a database at 0009 loses its groups and keeps every row", () => {
    applyMigrations(sqlite, migrationsThrough(9));
    seedGrouped();
    const chatsBefore = sqlite.prepare(`SELECT ${CHAT_FIELDS} FROM chats ORDER BY id`).all();

    applyMigrations(sqlite);
    expectGroupsGoneRowsKept(chatsBefore);
  });

  it("a fresh database ends without groups", () => {
    applyMigrations(sqlite);

    expect(journalRows()).toBe(12);
    expect(hasTable("chat_groups")).toBe(false);
    expect(chatColumns()).not.toContain("group_id");
  });
});
