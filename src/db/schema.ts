import { sqliteTable, text, integer, real, index, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import type Anthropic from "@anthropic-ai/sdk";
import type {
  GenerationStatus,
  InterruptedReason,
  MessageStatus,
  RefusalInfo,
  RelayError,
  ThinkingOptions,
  Timings,
  UserRole,
} from "@shared/types";
import type { ForkOption } from "@shared/forks";

// ADR-0003: JSON columns are text with { mode: "json" }. Property names on the better-auth tables
// must match better-auth's field names; the DB column names are free.

const now = () => new Date();
const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
    // better-auth admin plugin fields
    role: text("role").$type<UserRole>().notNull().default("user"),
    banned: integer("banned", { mode: "boolean" }).notNull().default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires"),
    // Per-user all-time cost cap
    costCapUsd: real("cost_cap_usd"),
    costSpentUsd: real("cost_spent_usd").notNull().default(0),
    lastActiveAt: timestamp("last_active_at"),
    /** Settings: off skips the Haiku detection after each reply, so no Explore button and no spend. */
    exploreOptions: integer("explore_options", { mode: "boolean" }).notNull().default(true),
    // better-auth anonymous plugin: a guest until it signs in (its rows then move to that account).
    isAnonymous: integer("is_anonymous", { mode: "boolean" }).notNull().default(false),
    /** A guest's spend budgets (`spend_buckets` keys), from the address that created it; null for everyone else. */
    budgetKeys: text("budget_keys", { mode: "json" }).$type<string[]>(),
  },
  (t) => [index("users_role_idx").on(t.role), index("users_last_active_idx").on(t.lastActiveAt), index("users_created_idx").on(t.createdAt)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = sqliteTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("verifications_identifier_idx").on(t.identifier)],
);

/** Invite links: SHA-256 of a random 32-byte token, 7-day expiry, single use. */
export const invites = sqliteTable(
  "invites",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    usedAt: timestamp("used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("invites_user_idx").on(t.userId)],
);

export const chats = sqliteTable(
  "chats",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New chat"),
    /** Pinned chats sit in their own section at the top of the sidebar. */
    pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
    /** Set on a fork: the chat whose rows it copied; deleting the parent leaves the fork standing. */
    forkedFrom: text("forked_from").references((): AnySQLiteColumn => chats.id, { onDelete: "set null" }),
    /** Position of a fork's first own message; the divider renders above it. */
    forkPosition: integer("fork_position"),
    forkOrder: integer("fork_order"),
    /** The tab was closed; it comes back when the chat is opened. */
    tabHidden: integer("tab_hidden", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
    lastMessageAt: timestamp("last_message_at"),
  },
  (t) => [index("chats_user_updated_idx").on(t.userId, t.updatedAt), index("chats_forked_from_idx").on(t.forkedFrom)],
);

export type StoredContentBlock = Anthropic.Beta.BetaContentBlock;

export const messages = sqliteTable(
  "messages",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").$type<"user" | "assistant">().notNull(),
    /** Order within the chat. UUIDv7 also sorts by time, but this is explicit. */
    position: integer("position").notNull(),
    /** Anthropic.ContentBlock[] with any `fallback` block kept in place. */
    content: text("content", { mode: "json" }).$type<StoredContentBlock[]>().notNull(),
    status: text("status").$type<MessageStatus>().notNull().default("done"),
    requestedModel: text("requested_model"),
    servingModel: text("serving_model"),
    stopReason: text("stop_reason"),
    refusal: text("refusal", { mode: "json" }).$type<RefusalInfo>(),
    error: text("error", { mode: "json" }).$type<RelayError>(),
    generationId: text("generation_id"),
    timings: text("timings", { mode: "json" }).$type<Timings>(),
    /** The effort a reply was asked with; a fork repeats it so the prompt cache holds. */
    thinking: text("thinking", { mode: "json" }).$type<ThinkingOptions>(),
    /** Haiku's fork prompts for a reply: null = not run, [] = no options. */
    forkOptions: text("fork_options", { mode: "json" }).$type<ForkOption[]>(),
    /** The last producer seq folded into `content` by the write that saved it, for resume; null for user messages and old rows. */
    lastSeq: integer("last_seq"),
    /** The text blocks of `content`, kept by a trigger for the FTS5 index. */
    searchText: text("search_text"),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
    updatedAt: timestamp("updated_at").notNull().$defaultFn(now),
  },
  (t) => [index("messages_chat_position_idx").on(t.chatId, t.position)],
);

export type IterationUsage = NonNullable<Anthropic.Beta.BetaUsage["iterations"]>;

export const generations = sqliteTable(
  "generations",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The assistant message this generation fills. */
    messageId: text("message_id").notNull(),
    userMessageId: text("user_message_id").notNull(),
    status: text("status").$type<GenerationStatus>().notNull().default("running"),
    interruptedReason: text("interrupted_reason").$type<InterruptedReason>(),
    requestedModel: text("requested_model").notNull(),
    servingModel: text("serving_model"),
    stopReason: text("stop_reason"),
    /** usage.iterations from the final message_delta. */
    iterations: text("iterations", { mode: "json" }).$type<IterationUsage>(),
    error: text("error", { mode: "json" }).$type<RelayError>(),
    provider: text("provider").notNull().default("anthropic"),
    scenario: text("scenario"),
    startedAt: timestamp("started_at").notNull().$defaultFn(now),
    endedAt: timestamp("ended_at"),
  },
  (t) => [
    index("generations_chat_idx").on(t.chatId),
    index("generations_status_idx").on(t.status),
    index("generations_user_idx").on(t.userId),
    index("generations_message_idx").on(t.messageId),
  ],
);

/** One row per iteration; `estimated` when settled without final usage. */
export const usageEvents = sqliteTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    // Spend outlives the reply it paid for: a replaced or truncated generation leaves its usage rows behind.
    generationId: text("generation_id").references(() => generations.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    iterationType: text("iteration_type").notNull().default("message"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    estimated: integer("estimated", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at").notNull().$defaultFn(now),
  },
  (t) => [index("usage_user_idx").on(t.userId), index("usage_generation_idx").on(t.generationId)],
);

/** Guest spend per budget key: the level drains continuously at the key's USD-a-day rate from `updated_at`. */
export const spendBuckets = sqliteTable("spend_buckets", {
  key: text("key").primaryKey(),
  levelUsd: real("level_usd").notNull().default(0),
  updatedAt: timestamp("updated_at").notNull(),
});

/** Instance-wide switches from the admin page: a single row, id 1. */
export const instanceSettings = sqliteTable("instance_settings", {
  id: integer("id").primaryKey(),
  guestsBlocked: integer("guests_blocked", { mode: "boolean" }).notNull().default(false),
});

export type User = typeof users.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Generation = typeof generations.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
export type Invite = typeof invites.$inferSelect;
