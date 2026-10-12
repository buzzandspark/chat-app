# ADR-0003: Persistence

Status: accepted · Date: 2026-10-06

## Context

The app needs to store users, sessions, chats, messages with their full content blocks, per-generation state for resume, and per-iteration usage for cost caps. It must run in one process with no external services.

## Decision

SQLite via Drizzle and `better-sqlite3`. JSON columns are `text` with `{ mode: "json" }` and a TypeScript type, so content blocks are stored verbatim as `Anthropic.ContentBlock[]`, with any `fallback` block kept in place.

Tables:

- `users` (role `admin | user | guest`, `cost_cap_usd` nullable, `cost_spent_usd`, `is_anonymous`), `sessions`, `accounts`, `verifications`: the better-auth tables, plus the admin and anonymous plugin fields.
- `invites`: token hash, expiry, `used_at`, `revoked_at`.
- `chats` (with `forked_from`, `fork_position`, `pinned`, `tab_hidden`).
- `messages`: `position`, `content`, `status`, `requested_model`, `serving_model`, `stop_reason`, `refusal`, `error`, `timings`, `last_seq`, `fork_options`.
- `generations`: `status`, `interrupted_reason`, `iterations` (usage per attempt), `provider`, `scenario`.
- `usage_events`: one row per iteration with model, tokens, cost, and `estimated`.

Partial persistence: the engine writes accumulated assistant content every 2 s while streaming and on every terminal event, so a crash loses at most 2 s of text.

## Alternatives rejected

- **Storing only the final text.** Fallback boundaries, thinking blocks, and signatures must round-trip to the API unchanged, so the stored unit is the content block array.
- **A separate `events` table.** Events are replayable from the in-memory buffer and, after eviction, from the message snapshot. Persisting every delta would multiply writes for no resume benefit.
- **An ORM with migrations at deploy time.** Migrations run at boot so a PR environment with a fresh volume is self-initialising.
