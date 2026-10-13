# Chat

A phone-first streaming chat client for Claude. One Node process, SQLite, and a replay harness that makes every failure mode reproducible.

## Run locally

Requires Node 24 and pnpm 10 (`corepack enable`).

```sh
pnpm install
cp .env.example .env
```

In `.env`, set:

- `ANTHROPIC_API_KEY`: your key from console.anthropic.com. Leave it empty to run in replay mode (scripted replies, no spend); production then also needs `REPLAY_MODE=1`.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` (8+ chars; production needs 10+ and refuses `change-me`): the admin account, created at boot if that email has none (the password applies only then).

```sh
pnpm dev    # http://localhost:3000
```

Migrations run at boot; the database is `data/app.db`. A first visit makes you a guest (Haiku only, a small cost cap and shared daily budgets). Sign in with the admin credentials for every model with no cap. Invite other users from the admin console at `/admin`.

## Architecture

```
browser ── POST /api/chat ──▶ route ──▶ relay engine ──▶ Anthropic (or scripted provider)
   ▲                                       │
   └── SSE, resumable by seq ◀── in-memory event buffer ──▶ SQLite (rows saved every 2 s)
```

- `src/relay/`: framework-free generation engine. A reply runs detached from the request, buffers its events in memory, and saves partial content to SQLite.
- `src/client/`: external chat store and transport. Events apply once per animation frame, idempotent by `(generationId, seq)`; streaming lives outside React.
- `src/db/`: Drizzle schema and migrations. `src/auth/`, `src/server/`: better-auth, guests, rate limits, boot and shutdown.
- `app/`: Next.js App Router pages and route handlers.

### Explore options: the background Haiku call

```
relay engine ── reply settles "done" ── afterDone ──▶ OptionsService (detached)
                                                         │  skipped: fork, empty reply, Explore off, at cap, 10 forks
                                                         ▼
                                                 OptionsMessenger ──▶ Haiku 5.5 (own client, structured output, streamed)
                                                         │            or scripted (scenario, replay, non-billable reply)
                     in-memory progress ◀────────────────┴────────────▶ messages.fork_options + usage_events
                            │
browser ◀── GET /api/messages/:id/options (JSON lines: count, each option as it completes, final list)
```

- `src/relay/options/`: `OptionsService` gates, meters and tracks each detection; `LiveOptionsMessenger` makes one streamed structured-output call and reports the count and each completed option as they parse; `ScriptedOptionsMessenger` answers scenarios and replay mode.
- The hook runs after the reply's rows, spend and terminal event are written and can't affect the reply; a failure only leaves it without options. Haiku sees the final reply text, never the chat history.
- Progress lives in memory while the call runs and for a minute after; later reads come from `fork_options`.
- Every call writes a `usage_events` row under the parent generation and counts against the user's cap; a call that breaks off is charged an estimate. Guest calls hold their worst-case cost against the budgets and run at most 2 per guest and 50 overall: detection waits for a slot, a rewrite is refused as busy.
- `POST /api/messages/:id/options/rewrite` applies one instruction to every prompt through the same messenger; the result goes back to the sheet and isn't stored.

## Major decisions

- **One long-lived process with SQLite** (ADR-0002, 0003): replies outlive their HTTP request and resume reads an in-process buffer. No serverless, no Redis.
- **SSE over `fetch` with client-chosen ids** (ADR-0001): a duplicate send attaches to the running reply, and one `GET /api/generations/:id/events?after=<seq>` endpoint covers reconnects, reloads and restarts.
- **Client store first** (ADR-0005): the chat view renders from the store and server rows only seed it, so switching chats paints in the next frame.
- **Guests and invites** (ADR-0004): visitors are capped Haiku guests; accounts are invite-only with per-user cost caps metered as replies stream.
- **Explore options** (ADR-0006): Haiku detects alternatives in a reply; forks copy the chat and share its prompt cache.
- **Replay harness**: scripted scenarios exercise disconnects, fallbacks, refusals and errors without spending; replay mode answers every chat from them.

Details: `docs/design-doc.md`, `docs/adr/`. Deployment and guest limits: `docs/self-host.md`.

## Check

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm size
pnpm e2e --project=pixel7      # then --project=iphone14 --project=desktop
pnpm test:shutdown             # SIGTERM and SIGKILL mid-stream against the built server
```

Scripts that build or drive a server refuse to run in a checkout whose dev server is live (`ALLOW_SHARED_DEV=1` overrides). `pnpm worktree` makes a sibling checkout with its own `node_modules` and `data/`, and prints a dev command on port 3141.
