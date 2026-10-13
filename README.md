# Chat

A phone-first streaming chat client for Claude. One Node process, SQLite, and a replay harness that makes every failure mode reproducible.

## Run locally

Requires Node 24 and pnpm 10 (`corepack enable`).

```sh
pnpm install
cp .env.example .env
```

In `.env`, set:

- `ANTHROPIC_API_KEY`: your key from console.anthropic.com. Leave it empty to run in replay mode (generated fixtures, no spend); production then also needs `REPLAY_MODE=1`.
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` (8+ chars; production needs 10+ and refuses `change-me`): the admin account, created at boot if that email has none (the password applies only then).

```sh
pnpm dev    # http://localhost:3000
```

Migrations run at boot; the database is `data/app.db`. A first visit makes you a guest (Haiku only, a small cost cap and shared daily budgets). Sign in with the admin credentials for every model with no cap. Invite other users from the admin console at `/admin`.

## Architecture

```
browser ── POST /api/chat ──▶ route ──▶ relay engine ──▶ Anthropic (or replay / scripted provider)
   ▲                                       │
   └── SSE, resumable by seq ◀── in-memory event buffer ──▶ SQLite (rows saved every 2 s)
```

- `src/relay/`: framework-free generation engine. A reply runs detached from the request, buffers its events in memory, and saves partial content to SQLite.
- `src/client/`: external chat store and transport. Events apply once per animation frame, idempotent by `(generationId, seq)`; streaming lives outside React.
- `src/db/`: Drizzle schema and migrations. `src/auth/`, `src/server/`: better-auth, guests, rate limits, boot and shutdown.
- `app/`: Next.js App Router pages and route handlers.

## Major decisions

- **One long-lived process with SQLite** (ADR-0002, 0003): replies outlive their HTTP request and resume reads an in-process buffer. No serverless, no Redis.
- **SSE over `fetch` with client-chosen ids** (ADR-0001): a duplicate send attaches to the running reply, and one `GET /api/generations/:id/events?after=<seq>` endpoint covers reconnects, reloads and restarts.
- **Client store first** (ADR-0005): the chat view renders from the store and server rows only seed it, so switching chats paints in the next frame.
- **Guests and invites** (ADR-0004): visitors are capped Haiku guests; accounts are invite-only with per-user cost caps metered as replies stream.
- **Explore options** (ADR-0006): Haiku detects alternatives in a reply; forks copy the chat and share its prompt cache.
- **Replay harness**: scripted scenarios and generated fixtures exercise disconnects, fallbacks, refusals and errors without spending.

Details: `docs/design-doc.md`, `docs/adr/`. Deployment and guest limits: `docs/self-host.md`.

## Check

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm size
pnpm e2e --project=pixel7      # then --project=iphone14 --project=desktop
pnpm test:shutdown             # SIGTERM and SIGKILL mid-stream against the built server
```

Scripts that build or drive a server refuse to run in a checkout whose dev server is live (`ALLOW_SHARED_DEV=1` overrides). `pnpm worktree` makes a sibling checkout with its own `node_modules` and `data/`, and prints a dev command on port 3141.
