# Chat design doc

## 1. Goals

A phone-first chat client for Claude that streams smoothly, survives disconnects and restarts without losing or duplicating a reply, loads fast, and can reproduce every failure mode deterministically. It runs as one long-lived Node process with SQLite. Visitors start as guests on Haiku under a small cost cap; invited accounts get every model under their own cap.

## 2. Architecture

- Next.js App Router, strict TypeScript, one Node process (ADR-0002).
- `src/relay/`: generation engine, providers, in-memory event store, Anthropic stream parsing, Explore options and forks. No framework imports.
- `src/db/`: Drizzle schema, SQLite client, migrations (ADR-0003).
- `src/server/`: request-side helpers (current user, guests, rate limits, boot, shutdown).
- `src/auth/`: better-auth setup and invites (ADR-0004).
- `src/client/`: external chat store, transport with resume, markdown renderer, components, hooks.
- `instrumentation.ts`: boot (migrations, crash backstop, guest purge) and SIGTERM drain.

Decisions with their alternatives are in `docs/adr/`: transport (0001), topology (0002), persistence (0003), identity (0004), client-store chat route (0005), Explore options and forks (0006).

## 3. Streaming pipeline

```
Composer ──POST /api/chat──▶ route ──engine.start()──▶ rows (user msg, assistant placeholder, generation=running)
                                │                           │
                                │                    provider.stream()  (anthropic | replay | scripted)
                                │                           │  raw Anthropic events
                                │                    normalizeEvent() ──▶ RelayEvent bodies
                                │                           │
                                ◀──SSE (encodeSse)── EventStore.append()  seq = buffer index
                                                            │
                               client ChatStore ◀─ GET /events?after=seq ─┘ (resume: buffered slice, then live)
```

- **Providers** (`src/relay/providers/`) all yield raw Anthropic stream events. Scripted scenarios and on-disk fixtures share `scriptToFixture`, so a scenario behaves the same from memory or from `fixtures/<model>/<scenario>.jsonl`. `RecordingProvider` wraps the live provider under `RECORD=1`. Scenarios are free for every signed-in user.
- **Normalizer** (`anthropic/parse-stream.ts`) maps the Anthropic stream into the relay vocabulary. A `fallback` block before any text is invisible; after text it emits a visible `fallback_boundary` and keeps the partial.
- **Accumulator** (`anthropic/accumulate.ts`) builds the content blocks to persist; the engine writes them every 2 s and on every terminal event.
- **History** (`anthropic/history.ts`) echoes thinking blocks unchanged, drops what precedes a final fallback block and unsigned thinking from interrupted streams, excludes refused and errored replies, and places the moving cache breakpoint on the newest user message. `request.ts` is the only request builder.
- **Event store** (`store.ts`): `Map<generationId, buffer>`; append notifies subscribers synchronously; finished buffers are evicted a minute later and resume falls through to SQLite.
- **Wire format**: one `data:` line per event; deltas omit fields the reader restores; replayed slices coalesce into one delta per run; live deltas batch per 16 ms; gzip with a sync flush per batch.
- **Client store** (`src/client/store/chat-store.ts`): events queue and flush once per animation frame, applied idempotently by `(generationId, seq)`, so a streaming message re-renders once per frame and nothing else re-renders. Streaming connections live outside React.
- **Markdown** (`src/client/markdown/`): `marked`'s lexer feeds a token-to-React renderer (no `innerHTML`). A fence- and table-aware splitter re-parses only the trailing block while streaming. Code highlighting runs in a Web Worker (shiki core, one chunk per language), is cached by content hash, and commits in 16-line groups with their own layout containment.

## 4. Reliability

- **Idempotent send.** The client picks UUIDv7 ids; a duplicate POST attaches to the existing generation instead of starting a second one.
- **One resume path.** `GET /api/generations/:id/events?after=<seq>` serves the buffered slice then live events; a `running` row with no buffer (process restarted) becomes `interrupted` and returns a snapshot; an evicted generation returns its saved snapshot; no row means the client re-POSTs with the same ids.
- **Rows record their seq.** Every saved row stores `messages.last_seq`, so its content is exactly events `0..last_seq` and a reload or second tab resumes right after it. Reloading mid-stream yields the same text as the uninterrupted tab.
- **Snapshots apply by seq and status.** Final rows replace local state; otherwise whichever side covers more of the stream wins, and a finished local reply is never replaced by a `streaming` row.
- **Watchdogs.** The server sends an SSE keepalive every 15 s; the client treats 25 s of silence as a dead socket and resumes. The engine ends a generation whose upstream is silent for 60 s as `interrupted`.
- **Reconnect** (`src/client/transport/generation-client.ts`): jittered backoff from 500 ms to 8 s, 10 attempts, then an offline state with manual retry. `online` and `visibilitychange` retry at once. Only a definite answer ends the loop: 401/403 get their own wording, a 404 after the server acknowledged the generation means the chat was deleted. A rate-limited send retries itself up to four times, honouring `retry-after`.
- **Stop is explicit.** `POST /stop` aborts upstream; closing a tab never stops a generation.
- **Shutdown.** `instrumentation.ts` owns SIGTERM (`NEXT_MANUAL_SIG_HANDLE`): the engine aborts upstream, saves each partial, settles estimated cost, marks rows `interrupted { reason: "shutdown" }` and notifies clients; open streams get 2 s to flush, then SQLite closes. After a SIGKILL the boot backstop marks orphaned rows `crash`. `pnpm test:shutdown` covers both.
- **Terminal states** each have their own wording and action in the status footer: rate limited, overloaded, API error, key problem, quota exceeded, interrupted, cut off (Continue), context full, refusal.

## 5. Models, thinking, fallback, caching

The per-model request shape lives in `src/relay/anthropic/thinking-config.ts`.

| | Sonnet 5.5 (default), Opus 5.5 | Haiku 5.5 |
| --- | --- | --- |
| Thinking | `adaptive`, `display: "summarized"` | same |
| "Think harder" | `effort: "high"` (default `"low"`) | same |
| Fallbacks | `fallbacks: "default"` (beta) | none |
| Binding | `prefix_mismatch_behavior: "drop_block"` (beta) | same |
| `max_tokens` | 16,000 | 16,000 |

- **`drop_block`** keeps chats with thinking blocks working after a system prompt change, which would otherwise turn every such chat into a 400.
- **Model per message.** Sticky fallback routing can serve later turns on another model, so `requested_model` and `serving_model` are stored per assistant message; the picker only chooses the next turn.
- **Refusals** (`stop_reason: "refusal"`) are their own status: painted text is dimmed, marked unsaved, and excluded from later history.
- **Caching.** The system prompt carries the first breakpoint, the newest user message the second. `pnpm test:cache` (opt-in, spends money) asserts cache reads per model.
- **Cost.** Only live calls are metered; scripted and replayed runs cost nothing. Each usage iteration is priced at its own model's rates. Stopped or interrupted replies are settled as estimates: exact input, output from streaming time times a rolling tokens-per-second per model.
- **Cap.** A reply starts if its estimated input fits under the user's remaining cap, then is metered per delta as it streams. When spend plus live meters reach the cap, all of that user's running replies stop with `quota_exceeded` and keep their text. Overshoot is bounded by about one chunk per running reply.

## 6. Identity and abuse (ADR-0004)

- better-auth on the Drizzle adapter: email + password, sign-up disabled, admin and anonymous plugins. `proxy.ts` only checks for a session cookie; real validation happens once per request and once per SSE connection.
- **Accounts** are created by the admin and activated through a single-use invite link (32-byte token stored as SHA-256, 7-day expiry); the same flow resets passwords. The first admin is seeded from `ADMIN_EMAIL`/`ADMIN_PASSWORD`. The admin console lives at `/<ADMIN_PATH_SLUG>` and 404s for everyone else.
- **Guests.** A visitor without a session is sent through `/api/guest`, which creates an anonymous user (role `guest`, Haiku only, `GUEST_COST_CAP_USD` cap). New guests are rate limited per address and globally per day; past that it is sign-in only. Signing in moves the guest's chats and usage to the account. Idle guests are purged after 30 days.
- **Ownership** is checked on every buffer read (resume, duplicate POST, stop); a generation id is not a capability.
- **Settlement** (`settle` in the engine) runs the database write, cost settlement, terminal event and cleanup independently, so a chat deleted mid-stream can't strand a buffer or lose spend.
- **Rate limits** are in memory, keyed on the address the trusted proxy saw (`TRUST_PROXY_HOPS`). Sends have no window; the cost cap is the spend limit.
- **Headers** (`next.config.ts`): `nosniff`, frame denial, a strict referrer policy, a restrictive Permissions-Policy, COOP, HSTS in production. No `script-src` CSP yet, since per-request nonces would end the shell's static prerender. Cross-site state-changing requests are refused in `proxy.ts`.

## 7. Explore options and forks (ADR-0006)

After a live reply settles, `OptionsService` asks Haiku whether the reply lays out alternatives and stores up to ten `{ title, prompt }` options on the message. Results stream to the client as JSON lines. When there are two or more, an Explore button rises above the composer; its sheet lets the user pick options, edit their prompts (or rewrite them all with one instruction through Haiku), and fork.

A fork copies every parent row into a new chat, then starts the parent's model and effort on the option's prompt. Fork 1 runs alone until `message_start` so the others read the cache entry it wrote. Forks appear as tabs on the composer; a fork can be declared the winner, which deletes the rest. Explore can be turned off per user in settings, in which case Haiku is never called.

## 8. Performance

- **JS budget.** `pnpm size` gates the chat route's initial JS at 205 kB gzipped (about 133 kB is Next and React). Radix controls, the markdown renderer and dialogs load on first intent (`useIntent`, `lazy-chunk.ts`) behind look-alike stand-ins, never in first paint. Sentry is assembled from named imports in an idle-loaded chunk.
- **Chat switching (ADR-0005).** The view renders from the client store; server rows only seed it. The sidebar prefetches chats on hover, focus, `touchstart`, and the top five when it opens, so a click paints the thread in the next frame.
- **First paint.** Sidebar layout is decided in CSS, not by a media-query hook, so desktop cold loads have zero layout shift. The theme script runs in `<head>` before first paint.
- **Long chats.** Rows use `content-visibility: auto`, gated on scroll anchoring that actually works (WebKit lays every row out). Thread virtualisation was not needed at measured frame times.
- **Search** is an FTS5 index over a text shadow column maintained by triggers.
- `e2e/perf.spec.ts` measures CLS, paint timings, frame times and click-to-thread on an emulated Pixel 7 (CPU 4x, Fast 3G). Its budgets gate local runs; CI (`PERF_BUDGETS=report`) records misses in the step summary and keeps the behaviour assertions blocking.

## 9. Rejected alternatives

- **`EventSource`**: cannot POST or set headers and reconnects on its own schedule (ADR-0001).
- **WebSockets**: bidirectional transport isn't needed (stop is a POST), and SSE over fetch resumes with the same code path as a cold load.
- **Serverless or multi-instance** (ADR-0002): a generation must outlive its response and resume must read a shared buffer.
- **Postgres** (ADR-0003): a second service for a single-instance app; Drizzle keeps a dialect swap mechanical.
- **Persisting every event**: resume reads the in-memory buffer, then the message snapshot.
- **`react-markdown`/remark**: larger, and the custom renderer over `marked` never touches `innerHTML`.
- **A hand-written class merger instead of `tailwind-merge`**: shipped layout bugs; correct merging is worth its 10 kB.
- **Virtualising the thread**: `content-visibility` is enough and keeps find-in-page.
- **OAuth, shared demo accounts** (ADR-0004).

## 10. Scaling past one process

The single-process topology is deliberate. N instances would need:

- **A shared event store**: Redis streams per generation (`XADD`/`XREAD` from a seq), writes batched per ~16 ms.
- **Producer leases**: one instance drives a generation under a renewed TTL lease; an expired lease without a terminal event is the cross-instance boot backstop.
- **Cross-instance resume**: `GET /events?after=` reads the stream from any instance, falling back to SQLite snapshots.
- **Stop and shutdown** via the producer's control channel; shutdown hands back leases.
