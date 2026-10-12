# Cadence design doc

> Written as the work happens. Sections marked _pending_ are filled in at the build step that lands them.

## 1. Goals

A chat client modelled on the Claude desktop app that demonstrates streaming quality, reliability across disconnects, fast loads, a phone-first feel, a deterministic replay harness, and clear technical writing. It runs as one long-lived Node process with SQLite, opens to a public replay-only demo, and gives invited accounts live models under a cost cap.

## 2. Architecture

- Next.js App Router, strict TypeScript, one Node process (ADR-0002).
- `src/relay/`: engine, providers, in-memory event store, Anthropic stream parsing. No framework imports.
- `src/db/`: Drizzle schema, SQLite client, migrations (ADR-0003).
- `src/client/`: external store, transport with resume, markdown block splitter, components, hooks.
- `instrumentation.ts`: boot (migrations, backstop, purge timer) and SIGTERM drain.

## 3. Key decisions

See `docs/adr/` for transport (0001), topology (0002), persistence (0003), identity (0004), the chat route rendering from the client store (0005). Decision numbers D0 to D28 referenced in code comments map to the build plan.

## 4. Streaming pipeline

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

- **Scenarios** (D24) are available to every signed-in user: the provider resolver serves a named scenario from the scripted provider whatever the account, so they spend nothing and need no flag.
- **Providers** (`src/relay/providers/`) all yield raw Anthropic stream events. `ScriptedProvider` and the on-disk fixtures share `scriptToFixture`, so a scenario behaves identically from memory or from `fixtures/<model>/<scenario>.jsonl`. `RecordingProvider` wraps the live provider under `RECORD=1`.
- **Normalizer** (`src/relay/anthropic/parse-stream.ts`) turns `message_start`, block start/delta/stop, `message_delta`, and SSE-level `error` events into the relay vocabulary. A `fallback` block before any text is an invisible boundary (timing and `iterations` only); after text it emits a visible `fallback_boundary` and the partial is kept. The serving model is the last fallback block's `to.model`, else `message_start.message.model`, cross-checked against a `fallback_message` iteration entry for sticky-routed turns.
- **Accumulator** (`accumulate.ts`) builds the `ContentBlock[]` to persist at any point in the stream; the engine writes it every 2 s and at every terminal event.
- **History** (`history.ts`) echoes thinking blocks unchanged, omits thinking and tool use before a message's final fallback block, drops unsigned thinking from interrupted streams, excludes refused and errored assistant messages, and puts the moving cache breakpoint on the newest user message. `request.ts` adds the fixed system prompt breakpoint and the per-model thinking, effort, betas, `fallbacks`, and `block_binding` from `thinking-config.ts`.
- **Event store** (`store.ts`): `Map<generationId, { events, subscribers, terminal }>`; `append` notifies synchronously; terminal buffers are evicted 10 minutes later and resume falls through to SQLite.
- **Client store** (`src/client/store/chat-store.ts`): producer events queue and flush once per animation frame, applied idempotently by `(generationId, seq)`; control events (`seq: null`) apply at once after a flush. One new state object per touched message per frame, so a streaming message re-renders once per frame and nothing else re-renders.
- **Markdown** (`src/client/markdown/`): a fence- and table-aware block splitter memoises finished blocks by hash so only the trailing block re-parses; unclosed fences render as plain monospace; closed fences highlight in idle time with per-language shiki imports and identical metrics, so highlighting changes paint only.

Measured on the scripted `normal` scenario through the built server: 62 events, first relayed token 454 ms after receipt (the script's own time-to-first-token), `done` with per-iteration usage.

## 5. Reliability

- **Idempotent send.** Ids are UUIDv7 chosen by the client. `engine.start` returns `created: false` for a known generation and the route attaches the response to the existing buffer, so a duplicate POST on a flaky network never starts a second generation.
- **One resume path.** `GET /api/generations/:id/events?after=<seq>` serves the buffered slice then live events; a `running` row with no buffer (process restarted) is marked interrupted and returned as a snapshot; a terminal row with no buffer (evicted) returns its saved snapshot; no row is a 404 and the client re-POSTs with the same ids. The client's cursor is flushed before every resume so it never re-requests what it already has.
- **Every saved row says which seq it covers.** The partial writer and the final writer store `messages.last_seq`, read in the same synchronous step as the accumulator, so a row's content is exactly the fold of events `0..last_seq`. A client that seeds from rows (a reload, a second tab) starts its cursor there and resumes after it; the stream index map is rebuilt from the saved blocks (which are in stream order; only an empty trailing block is omitted, and a delta for an index the client has never seen creates it). This is what makes "reload mid-stream" produce the same text as the uninterrupted tab, character for character.
- **Snapshots are applied by seq and status.** A final row (`done`, `refused`) replaces local state. Otherwise the side that covers more of the stream wins, by `last_seq` when the row has one and by text length for rows written before it existed; taking the server's content moves the cursor past the seq it covers, so a late replay of the same deltas is dropped as duplicates. A finished local reply is never replaced by a `streaming` row, whichever path delivers it.
- **Watchdogs on both hops.** The server writes an SSE keepalive every 15 s; the client treats 25 s without bytes as a half-open socket, cancels the reader and resumes from its last seq through the ordinary backoff (so the "Reconnecting" state shows instead of a frozen reply). The engine races every upstream read against a 60 s idle timer and ends a silent generation as `interrupted { reason: "upstream" }`, settling its estimated cost like any other interruption.
- **Reconnect** (`src/client/transport/generation-client.ts`): 500 ms to 8 s backoff with jitter, 10 attempts, then an offline state with manual retry; `online` and `visibilitychange` trigger an immediate attempt; progress resets the attempt count.
- **Stop is explicit.** `POST /stop` aborts upstream and appends `stopped`; closing a tab never stops a generation. Stopped and interrupted generations settle an estimated cost: input exact from `message_start`, output from elapsed streaming time times a rolling tokens-per-second per model.
- **Shutdown.** `instrumentation.ts` installs the SIGTERM handler (Next's own is disabled by `NEXT_MANUAL_SIG_HANDLE`). Drains run last-registered first: the engine aborts every upstream request, writes each partial, settles estimated cost, marks rows `interrupted { reason: "shutdown" }`, and appends the event to connected clients; the process then waits up to 2 s for open SSE sockets to flush, closes SQLite, and exits. `scripts/shutdown-test.sh` verifies this against the built standalone server, plus the SIGKILL case: saved content within 2 s of what the client displayed, and the boot backstop marking the row `crash` with an estimated usage row.
- **Terminal states** (D17) each have their own wording and action in `status-footer.tsx`: rate limited (countdown from retry-after), overloaded, API error, server-side key problem, quota exceeded, interrupted, cut off (Continue), context full (new chat), refusal in three variants with painted text dimmed and excluded from history.

## 6. Models, thinking, fallback, caching

Checked against the bundled Claude API reference on 2026-10-06; the per-model request shape lives in one place, `src/relay/anthropic/thinking-config.ts`, and `request.ts` is the only request builder, used by the live provider, the recorder, and the cache test alike.

| | Sonnet 5.5 (default), Opus 5.5 | Haiku 5.5 |
| --- | --- | --- |
| Thinking | `adaptive`, `display: "summarized"` | the same |
| "Think harder" | `output_config.effort: "high"` (default `"low"`) | the same |
| Fallbacks | `fallbacks: "default"` under beta `server-side-fallback-2026-07-01` | none (none is documented for it) |
| Binding | `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` under beta `thinking-binding-controls-2026-08-01` | the same |
| `max_tokens` | 16,000 | 16,000 |
| Pricing | flat per model | two tiers, the dearer one once the prompt (input plus cached tokens) passes 100k tokens |

Haiku 4.5 was removed on 2026-10-07 when Haiku 5.5 arrived: nothing had been saved with it, and 5.5 is cheaper on every line with a 1M window and effort-steered thinking, so no `budget_tokens` path remains.

- **Why `drop_block`.** The binding check covers the system prompt and tools as well as every earlier message, and is enforced by default for API accounts created on or after 2026-08-31. Without it, a deploy that edits the system prompt would turn every existing chat with thinking blocks into a 400. `input_transformations` from `message_start` is logged with the generation so prefix mismatches are visible; a `model_binding_mismatch` after a model switch is expected, not a bug.
- **Model per message, not per chat.** Sticky routing can serve later turns on the fallback model for about an hour and the requested model may be retried at any time, so `messages.requested_model` and `messages.serving_model` are stored per assistant message. The picker value only chooses the next turn. The serving model is the last `fallback` block's `to.model`, else `message_start.message.model`, cross-checked with a `fallback_message` entry in `usage.iterations` for sticky-routed turns that carry no block.
- **Fallback in the stream.** A `fallback` block arrives as an ordinary `content_block_start`. Before any text it is invisible except in timing (the latency popover labels the first-token interval "includes a declined attempt") and in `iterations`; after text, the open block closes, the relay emits `fallback_boundary`, the partial is kept, and the UI shows a divider ("Served by Claude Opus 4.8 after a safety fallback"). `history.ts` omits thinking and tool use before a message's final fallback block when echoing it back.
- **Refusal without fallback** (`stop_reason: "refusal"`, possible on Haiku, on `bio`/`reasoning_extraction`/`general_harms` categories on Sonnet 5.5, or when the whole chain declines) is its own message status. Painted partial text is dimmed, labelled "incomplete and not saved", excluded from later history, and has no retry affordance. Three wordings: category and explanation, category only, neither.
- **Caching.** The fixed system prompt carries the first `cache_control` breakpoint; the moving breakpoint is the newest user message's last text block. Minimum cacheable prefix is 512 tokens on Sonnet 5.5 and Opus 5.5, so `pnpm test:cache` (opt-in, spends money) sends a fixture above 4096 tokens twice per model and asserts non-zero `cache_read_input_tokens` on the second request. Cache fields are stored per iteration in `usage_events` and shown in the latency popover.
- **Context.** History is sent whole; all three models have 1M-token windows. A context-length 400 maps to `kind: "context_full"` and the UI says "This chat is too long to continue. Start a new chat."
- **Cost (D22).** Only the live provider (and its recorder) is billable: a scripted or replayed run reserves nothing, settles its usage rows at zero cost and never feeds the tokens-per-second estimator, so scenarios cannot consume or skew a cap. Each `usage.iterations` entry is priced at its own model's rates (a declined attempt is a `message` entry for the declined model; the serving hop is `fallback_message`). Stopped or interrupted generations are settled as estimates: exact input from `message_start`, output from elapsed streaming time times a rolling tokens-per-second per model, because billed output includes full thinking while only its summary is visible.

## 6a. Identity (ADR-0004, amended)

better-auth on the Drizzle adapter: email + password with sign-up disabled, the admin plugin for roles and bans. `proxy.ts` only checks for the session cookie; `getCurrentUser` validates with `auth.api.getSession` once per request and once per SSE connection. Every account is created by the admin and signed in through an invite link: invites are random 32-byte tokens stored as SHA-256 with a 7-day expiry and single use; issuing a new one revokes the old; the same flow resets a password. The public demo path (anonymous visitors with a `demo` role, replay-only, purged after 24 h) was removed on 2026-10-07; migration 0004 deletes the remaining demo rows and drops `users.is_anonymous`. Replay fixtures remain behind `REPLAY_MODE` for the harness and local development. The admin console lives at `/${ADMIN_PATH_SLUG}` and renders the not-found page for anyone else.

## 6b. Abuse and isolation

- Every buffer read checks ownership first: `Engine.resume`, the duplicate-POST attach path, and stop. A generation id is not a capability.
- The engine's terminal path runs in `settle`: the database write, the cost settlement, the terminal event and the cleanup each run regardless of the others' failure, so a chat deleted mid-stream cannot strand a buffer, hold a quota reservation, or leave spend unrecorded. Delete and truncate stop and await running generations before removing rows.
- Open write endpoints are rate limited in memory (D1): the long-chat seed per user. Sends are limited per user (D17) and better-auth limits sign-ins per address in production.
- Headers (`next.config.ts`): every response carries `nosniff`, `X-Frame-Options: DENY` with CSP `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`, a strict referrer policy (no referrer at all on invite pages), a Permissions-Policy that turns off camera, microphone, location, payment and USB, COOP `same-origin`, and HSTS in production; API responses add `Cross-Origin-Resource-Policy: same-origin` and `X-Robots-Tag: noindex`. No `script-src` yet: Next's inline bootstrap scripts would need per-request nonces, which would end the shell's static prerender. A state-changing API request from another site is refused in `proxy.ts` (403 `cross_site`), by `Sec-Fetch-Site`, else by `Origin` against the host; better-auth checks its own endpoints.
- `.env` never enters the Docker build context.
- Limits (#62): the seed limiter keys on the address the trusted proxy saw (`TRUST_PROXY_HOPS`) and idle keys are swept; sends have had no running cap or window since 2026-10-09 (the cost cap is the only limit on spend), and a finished buffer lives one minute before a resume falls back to the saved snapshot. Invites are claimed atomically and end the account's other sessions (#63); an admin's delete or disable stops the user's running replies (#69).
- Shutdown (#70): drains run last-registered first, connected streams get up to 2 s to flush, and only then do the "close" tasks run (the database). Next's standalone server owns the HTTP listener, so the process cannot close it from `instrumentation.ts`; the platform's draining window (`railway.json`, 30 s) covers that.

## 6c. Explore options (ADR-0006)

After a live reply settles, `OptionsService` (`src/relay/options/`) asks Claude Haiku 5.5, through its own client and a zod output format, whether the reply lays out alternatives; the answer (`{ title, prompt }[]`, at most ten) is stored on the message (`messages.fork_options`) and priced into a usage row under the reply's generation. The engine's `afterDone` hook runs after the reply has settled and is isolated from it. Detection streams: the schema puts the count first, and `GET /api/messages/:id/options` answers with JSON lines (the count as soon as Haiku writes it, the options as each one completes, then the final list or an error; `Cache-Control: no-transform` keeps Next's compression from holding them back). The page follows it once when a reply ends on screen; a saved chat carries the final list in its rows. The Explore button is up only while it can be used: it rises from behind the composer's top border to where Jump to latest sits (which then moves above it) as soon as the count says two or more, and tucks back when the options are spent or can't be forked (a fork, ten forks already, an edit in progress, a new reply). There is no waiting state; a click before the list is complete pulses until it is (at most 5 s, or an error), then opens the sheet with what has arrived.

The Explore options button rises above the composer after a reply with options; a click opens the sheet (a lazy chunk on the responsive dialog) with every option picked: a checkbox, a tab title and the first message per option, and one instruction that rewrites every prompt through Haiku (`POST .../options/rewrite`). The sheet opens on its instruction input: Enter there applies the instruction, Shift+Enter forks, and its button forks the picked options.

`POST /api/chats/:id/fork` (`src/relay/forks.ts`) copies every parent row into each fork chat with fresh ids and the same positions, then starts the parent's model at the parent's stored effort (`messages.thinking`) on the prompt, with a second cache breakpoint on the parent's final reply, a three-attempt retry for a request that fails before the API begins a message (1 s, 2 s, 4 s, longer when the API asks), and a gate: fork 1 starts alone and the rest wait for its `message_start` (10 s at most), so they read the cache entry it wrote. A test asserts a fork's first request equals the parent's last in every parameter but the appended turns. Ten forks per parent at most, none of a fork; a scenario reply forks as a scripted reply. Forking spends the reply's options (they are set to empty), so the button goes away and stays away. The tab strip (`fork-tabs.tsx`) is a row of folder tabs on the composer's input, in its column (the open tab takes the input's colour and border and covers its top edge; without hover only the open tab shows its ×): a chat with forks never shows the button, and a fork grows the strip out of it (`tab-reveal.ts`: the button's outline widens to the strip, then each tab grows into its slot; plain DOM animations in a chunk fetched when the sheet opens; the sheet closes as soon as the forks exist and the strip holds at the button's box until it is gone, and a view mounting midway, the fork's own after the navigation, continues from the same moment). It lists the main chat and its forks from the sidebar store, drag-ordered with a mouse or pen and saved through `PUT /api/chats/:id/fork-order`; the thread shows "Forked from main chat" at `fork_position`. In the sidebar a parent with forks carries a fork icon and lists its forks nested beneath it only while it or one of them is open; a fork whose parent is gone stands alone. The sheet opens on its instruction input: Enter there applies the instruction, Shift+Enter forks. A press on the button released within 250 ms is a click; a longer press short of the 600 ms hold is abandoned. Each tab has a close key (`chats.tab_hidden`, through `PATCH /api/chats/:id`); a closed tab comes back when its chat is opened from the sidebar, and the strip hides with fewer than two tabs showing. Ctrl+Shift+] and [ cycle the tabs. A right-click on a tab offers Declare winner on a fork (`POST /api/chats/:id/declare-winner`: anything still streaming in the main chat and the other forks is stopped, they are deleted, and the winner stands alone with its history, forkable again), Delete forks on the main chat (`POST /api/chats/:id/delete-forks`: every fork goes, the main chat stays), and Delete chat; each behind a confirmation. Haiku returns only the list, empty when the reply is not a choice; a reply that explains two or more alternatives is a choice even when it recommends one, "when in doubt, it is not", and fewer than two items reads as none. The per-field rules live in the output schema's descriptions. Declaring a winner also reads the winner's last reply, which was skipped while it was a fork, so it can be forked at once. Past 4.5 minutes from the parent reply's request start the button's tooltip says the cache has expired (the entry's lifetime counts from the request that wrote it). Settings can turn Explore options off per user (`users.explore_options`, `PATCH /api/settings`): `OptionsService` then skips detection, so Haiku is never called and nothing is spent, and the page neither follows the options nor shows the button; the same page shows usage split between chat replies and Explore's `options` and `options_rewrite` rows.

## 7. Performance

### Chat route JS budget (D21)

Measured with `pnpm size` (gzipped, the chunks Turbopack lists for `/c/[id]` in `.next/server/app/(chat)/c/[id]/page/build-manifest.json` and `page_client-reference-manifest.js`; `nomodule` polyfills excluded) and attributed with `SOURCEMAPS=1 pnpm build && node scripts/bundle-report.mjs`:

| Step | kB gzipped | Change |
| --- | ---: | --- |
| First measurement (step 4, everything in the route bundle) | 283 | |
| Exclude `nomodule` polyfills from the count | 243 | −40 |
| Radix menus, dialogs, popover, model picker and scenario panel behind `next/dynamic` (load after first paint, on first use where there is a trigger) | 197 | −46 |
| `tailwind-merge` replaced by a 2 kB conflict-aware `cn` (`src/shared/cn.ts`) | 188 | −9 |
| `tailwind-merge` restored: the small merger treated `top`/`left` and `inset-x`/`inset-y` as one family and dropped classes shadcn relies on (centred dialogs rendered off screen) | 198 | +10 |
| Client store first (ADR-0005): seed, settings, skeletons, pending-chat store | 200.7 | +1.4 |
| Scenario labels and model blurbs leave the composer for the chunks that need them | 199.8 | −0.9 |
| Prefetch helper; unused shadcn button variants and sizes dropped | 199.9 | +0.1 |
| Resume by seq and both watchdogs; Radix `Slot` out of the first paint (`asChild` served two links); dead class and method removed | 198.8 | −1.1 |
| Review items: error boundaries, back-gesture entry, stand-ins for lazy controls, scroll-anchoring flag, sign out (a plain POST, not the auth client, which would have added 13 kB) | 204.6 | +5.8 |
| One shared error view; `cva` replaced by a lookup | 204.0 | −0.6 |
| Re-check fixes (session and forbidden wording, scenario on messages, settings inheritance, draft flush) less a table-driven status footer | 204.86 | +0.86 |

Where the 188 kB goes:

| Source | kB gzipped |
| --- | ---: |
| Next 16.4 app router runtime, React 19.3 (vendored under `next`), cache components client | 133 |
| `marked` lexer | 14 |
| `src/client/components` (shell, list, composer, footer, thinking) | 13 |
| `src/client/markdown`, `store`, `transport`, hooks | 10 |
| Turbopack runtime | 4 |
| Button, Slot, lucide icons, clsx | 4 |

The plan set the budget at 180 kB assuming a smaller framework floor; Next 16's runtime alone measures 133 kB, so the CI gate was 200 kB, which capped everything outside the framework at 67 kB. On 2026-10-07 the gate moved to 205 kB: the review's required additions cost about 5 kB of app code against 0.7 kB of headroom, every trim short of replacing `marked` is taken, and a gate that is quietly edited is worse than one moved in the open (figures in SI kilobytes as `size-limit` reports them). Correct class merging is worth its 10 kB: the hand-written replacement shipped visible layout bugs within a day. Search (#60) is an FTS5 index over `messages.search_text`, a shadow of the text blocks kept by triggers (in the initial migration); SQLite builds the snippet and the query carries a LIMIT, with a Unicode-folded title match alongside. On 2026-10-07 `marked` left the route's initial JS without being replaced: the Markdown renderer is a `next/dynamic` chunk (server-rendered for saved chats, fetched on the client with the first send), so an empty new chat never downloads it and the route has about 17 kB of headroom (193.17 kB measured at the end of 2026-10-07; a saved chat's rows wait behind the skeleton until that chunk is in and then render the loaded component directly, since a lazy wrapper's first-render suspension committed empty bodies that filled in a task later, a measurable layout shift) under the unchanged 205 kB gate.

### Measured on a throttled Pixel 7 (D0, D26)

`pnpm e2e --project=pixel7 e2e/perf.spec.ts` emulates a Pixel 7 with CPU 4x slowdown and Playwright's Fast 3G profile through the Chrome DevTools protocol, against the built standalone server on localhost (so TTFB is not representative), and appends to `docs/perf/<date>.json`. 2026-10-07, after this package (the 2026-10-06 column is the step 7 pass):

| Measure | 2026-10-06 | 2026-10-07 |
| --- | ---: | ---: |
| Shell: cumulative layout shift | 0 (0 shifts) | 0 (0 shifts) |
| Shell: first contentful paint | 1.50 s | 1.50 s |
| Shell: DOMContentLoaded | 1.38 s | 1.37 s |
| Shell: composer hydrated | 3.34 s | 3.57 s |
| Shell: bytes transferred | 325 kB | 307 kB |
| Shell: scripts fetched after hydration with no interaction | not measured (about 51 KiB of Radix chunks) | 0 |
| Shell: fonts | Inter loaded, metric-matched fallback, no swap | same |
| Desktop cold load: cumulative layout shift | not measured (review: 0.20) | 0, dock in the server HTML |
| Long reply streaming: first painted token after tap | 2.0 s | 2.0 s |
| Long reply streaming: frame time p50 / p95 / p99 | 16.7 / 16.8 / 16.8 ms, 0 of 625 over 50 ms | 16.7 / 16.7 / 16.8 ms, 0 of 626 over 50 ms |
| 200-message chat: time to hydrated after navigation | 0.93 s | 1.57 s (measured inside the full run) |
| 200-message chat streaming: frame time p50 / p95 / p99 | 16.7 / 16.8 / 33.4 ms, 3 of 560 over 50 ms | 16.7 / 16.8 / 16.8 ms, 3 of 575 over 50 ms |
| 1,800-line code block: frame time p50 / p95 / p99 while streaming and highlighting | 16.7 / 33.3 / 33.4 ms (window ended before highlighting) | 16.7 / 33.3 / 33.4 ms, 5 of 1,964 over 50 ms, longest 317 ms at done and 367 ms on reopen (review: 1.8 s at both) |
| Click to thread, loaded or prefetched chat | a round trip | row in frame 1, thread in frame 2 (26 to 33 ms) |
| Click to thread, cold chat (tap beats the top-five prefetch) | a round trip, no feedback | row in frame 1, skeleton in frame 2, rows at 330 ms |

Lighthouse is not wired in; CLS, paint timings, and font status are read from `PerformanceObserver` and `document.fonts` inside the same run, which gives the two numbers the plan asked for (CLS 0, no font flash) without a second toolchain.

### Chat route: client store first, server rows as a seed (ADR-0005)

```
sidebar row ──hover/focus/touchstart──▶ router.prefetch(shell) + GET /api/chats/:id ──▶ store.seedChat()
     │ click (onNavigate: pending id → row highlight, header title at once)
     ▼
/c/<id>  static shell: <Suspense fallback=ChatViewSkeleton> <ChatView>            ◀── useParams(), reads the store
                                                      └ <Suspense> <ChatSeed params/> ──▶ <SeedChat rows/> ──▶ store.seedChat()
```

- `ChatView` is in the route's static shell and reads its id from `useParams()`, which resolves synchronously on a client navigation. It renders `MessageList` from the store when the chat is seeded and a thread skeleton (the list's own spacing) when it is not; the composer is always the real one.
- `SeedChat` reconciles the server's rows during its render, so a hard load paints them in the first frame (the server renders the skeleton, hydration matches it, and `useSyncExternalStore`'s consistency check re-renders with the seeded store before paint). Rules: a local `streaming` message wins; a finished local reply is never replaced by a `streaming` row; optimistic messages the server has not listed yet stay after the server's rows; identical rows are not replaced, so a revisit re-renders nothing.
- New chat is `/c/<uuidv7>` chosen on the client and created in the store as seeded-empty, so it never shows a skeleton; the engine creates the row on the first send. `/c/new` is a 307 alias in `proxy.ts`. An id with no rows renders an empty view; a refused first POST (429, 503, 402) leaves the typed message on screen with its retry.
- Per-chat settings (model, "Think harder", scenario) live in `ChatState.settings`; drafts stay in `localStorage` per (user, chat). The first send does not navigate, so nothing remounts: the phone keyboard stays up and the picker keeps its value. One generation runs at a time, but typing never waits for it: a message sent while a reply streams is queued in `ChatState.queue`, shown as a dashed bubble under the thread with Edit and Remove, and dispatched by the view when the last reply reaches a terminal state other than `error` (one per finished reply; a failure leaves the queue to the user). Edits are not queued, since they replace turns that are still being written. A chat with replies opens on the model its last reply was asked of; an empty chat opens on the model and effort this user chose last (`cadence:settings:<userId>` in `localStorage`, applied through `ChatStore.setDefaultSettings` after mount, so the server HTML shows the default and the client switches once). Edit and Regenerate replace in one request: the POST carries `replaceFromMessageId`, the route settles the replaced turns' generations, and the engine deletes them in the same transaction that inserts the new rows, so there is no window with an empty gap and a refused start changes nothing on the server. Usage rows keep their spend when the generation they belong to is replaced (`generation_id` set to null).

Measured on 2026-10-07 against the production build with 100 ms of emulated network latency (CDP), milliseconds from the row's `pointerdown`; desktop at 1x CPU, Pixel 7 emulation at 4x. "Before" is commit `79f3845`, where every switch waited for the server-rendered thread.

| Case | Before: row highlight | Before: thread painted | After: row highlight | After: thread painted |
| --- | ---: | ---: | ---: | ---: |
| Loaded chat, desktop | 26 | 126 | 10 | 27 |
| Loaded chat, Pixel 7 4x | 30 | 130 | 13 | 29 |
| Cold chat (after a reload), desktop | 26 | 126 | 10 | 128 (skeleton at 27) |
| Cold chat, Pixel 7 4x | 29 | 131 | 13 | 131 (skeleton at 30) |

The composer measures 115 px on a phone and 135 px on desktop throughout; before, the page-level skeleton collapsed it to 56 px while a chat loaded. In development and over a real network the "before" round trip was about 650 ms; the "after" numbers for a loaded chat do not depend on the network at all.

`e2e/perf.spec.ts` ("click to thread") records the same thing in animation frames on the throttled Pixel 7 (CPU 4x, Fast 3G) and gates it: a loaded or prefetched chat highlights its row in the first frame after the click and paints its thread in the second (26 to 31 ms); a tap that beats the sidebar's own top-five prefetch shows the highlight in frame 1, the skeleton in frame 2 and the rows when the fetch lands (344 ms in that run). Prefetch on intent (hover, focus, `touchstart`, and the top five when the sidebar opens) fetches `GET /api/chats/:id` into the store next to `router.prefetch` of the shell, so the usual click is the loaded case.

### First paint: layout in CSS, theme in the head

- The sidebar is two states, not one: `phoneOpen` drives the overlay below `md` (`translate-x`), `desktopOpen` drives the dock at `md` (`md:flex` / `md:hidden`). The server renders the dock, because `desktopOpen` starts true and needs no media query, and hydration changes nothing; before, one merged `open` depended on `useIsDesktop()`, whose server snapshot is `false`, so every desktop cold load painted without the sidebar and shifted when hydration added it (CLS 0.20). `e2e/perf.spec.ts` ("desktop cold load") asserts CLS 0 and that the HTML already carries the docked class.
- The theme bootstrap is an inline `<script>` in `<head>`, rendered by `ThemeScript` from a `useSyncExternalStore` server snapshot: present in the server HTML (where it runs before any Next script and before the first paint, after the render-blocking stylesheet), matched during hydration, removed by the next render, and never created by a client render, so React's "Encountered a script tag while rendering" warning cannot fire on a client-render fallback. `next/script` with `beforeInteractive` was pushed through Next's `__next_s` queue and ran after the first paint for dark-mode users. `e2e/theme.spec.ts` checks the stored preference is applied before `first-paint` and that the script precedes the first `/_next/` script in the document.

### Code blocks: tokenise off the main thread, commit in line groups (D15)

`src/client/markdown/highlight.ts` keeps highlighted lines by content hash and hands tokenising to a Web Worker (`highlight.worker.ts`, shiki core with the JavaScript regex engine and one chunk per language, the same module the main thread falls back to where there is no `Worker`). A block seen once never tokenises again: a chat kept mounted by `<Activity>` shows the same element on reopen, and a remount is a cache hit. `CodeBlock` splits a closed block into groups of 16 lines, each a block with its own layout containment (`content-visibility: auto` with an exact intrinsic size), and upgrades one group per idle callback from plain text to spans, so the text never changes, a commit lays out one group instead of the whole `<pre>`, and groups off screen cost nothing. The first attempt committed groups into a flat `<code>`: React's work per step was constant but the browser re-laid out the entire 1,800-line block every time, so the step cost grew with what was already committed (30 frames over 50 ms, up to 333 ms). Measured on the throttled Pixel 7 (CPU 4x) after containment: longest frame 317 ms when the reply finishes and 367 ms on reopen (about 80 and 90 ms unthrottled) against the review's 1.8 s freeze at both moments, 4 to 5 long frames in a 2,000-frame window, p99 33 ms; tokens come from the worker; the reopen is the same element (or, after a remount, the cache). The remaining spikes recur every ~30 groups and grow with the committed DOM, which points at garbage collection or style work rather than tokenising; `e2e/perf.spec.ts` gates both maxima under 500 ms. On 2026-10-07 the two GitHub themes became one CSS-variables theme: tokens carry `color: var(--shiki-token-…)` and `code.css` holds both palettes, so a block is tokenised once for both themes and a theme switch is a repaint. A streaming fence is rendered as the same line groups as a closed one, each keyed on its own text, so a delta re-lays out one contained group, not the whole `<pre>`; and `splitBlocksIncremental` re-splits only the last block while a reply streams, since every earlier block is final once a later line has started a new one. A streaming table drops its last row and keeps fixed column widths until it closes.

### Sessions, errors and lazy chunks

The client transport's resume loop (D2, D16) treats only a definite answer as final: 401 and 403 end it with their own wording, a 404 before the server ever acknowledged the generation re-POSTs with the same ids, a 404 after it means the chat was deleted (`gone`), and 5xx, 429 and 408 keep the loop going with backoff and `retry-after`. A 429 on the POST itself (or an upstream rate limit surfaced as a `rate_limited` error) retries by itself from the message row: the server's retry-after is the base, doubled per attempt and capped at two minutes, four automatic tries, with the inline Try again for an immediate manual retry; the attempt count rides on the replacement message, and a saved error never auto-retries on open. `online` and `visibilitychange` nudge a loop in flight (cancel a quiet read, cut a backoff sleep short) rather than only starting loops for idle messages, so a half-open socket recovers as soon as the network is back and never waits out the 25 s watchdog. A resume whose cursor already covers the terminal event is answered with that event again, never an empty stream. On the wire (#49) an event is one `data:` line; deltas omit `generationId` and `t`, which the reader restores; a replayed slice is coalesced into one delta per run of text; live deltas are batched per 16 ms; and the response is gzipped with a sync flush per batch when the client accepts it, so a keepalive or a batch still leaves the process at once. The sidebar lists a new chat once its first generation is accepted; until then the chat exists only in the URL and the local store. The list is sectioned: pinned chats first (`chats.pinned`), then the rest; a chat row's ⋯ menu (also opened by right-click) carries Pin, Rename and Delete, and the row moves at once with the request behind it.

The (chat) layout puts its chrome in the static shell (#20): the sidebar frame, the header bar and the composer geometry prerender, and only what needs the session streams in behind its own Suspense: the chat list, the user label, the page, and a header island that reads the URL (title, inline rename, the pending chat's release, the store's eviction, closing the phone sidebar on navigation). `usePathname()` is URL data, so anything that reads it must sit inside a Suspense boundary for the route to prerender; the frame reads none. One `cache()`d session check serves all the slots. The docked layout is the `dock` variant (at least 48 rem wide and 30 rem tall), not plain `md:`, so a landscape phone keeps the overlay sidebar (#31).

`proxy.ts` only checks that a session cookie exists (ADR-0004); an expired, purged or banned one is caught by the chat layout, which redirects to `/login?next=<path>` (the proxy forwards the path) instead of throwing inside a Server Component. `app/(chat)/error.tsx`, `app/error.tsx` and `app/global-error.tsx` replace the dead page, and `ChunkBoundary` wraps every lazily loaded control (the model picker, the Scenarios button, message and chat menus), so a chunk that fails to load costs one control, not the thread; a dialog whose chunk fails simply doesn't open, and the next attempt fetches it again. Sign out is a full document load to `/login`: nothing of the old session may survive in memory. "Try the demo" reuses a live demo session and otherwise signs in anonymously without the stale cookie.

### Radix behind intent (D21)

Every Radix-backed control used to load its chunk at mount through `next/dynamic` (about 51 KiB after hydration on every chat). They now load on the first sign of intent (`pointerenter`, `focus`, `touchstart`) behind a look-alike stand-in (`useIntent`); a press loads the chunk, then swaps in the real control already open (`defaultOpen`). Since 2026-10-12 nothing renders through `next/dynamic` or Suspense here (`chunk()` in `lazy-chunk.ts` loads, then the loaded component renders directly): a lazy component suspends on its first mount even when its code is in, and React holds a boundary's content back 300 ms after its fallback shows, which was the ~310 ms before every modal and menu first opened. Dialogs share one chunk, preloaded in idle time (`load-dialogs.ts`); a chunk that fails to load is forgotten, so the next attempt fetches it again. Sentry (started from `instrumentation-client.ts`, its DSN inlined at build) is assembled from named imports (`BrowserClient`, the fetch transport, the default stack parser, the global-handlers and dedupe integrations) in its own idle-loaded module instead of `init`, which drags in every default integration.

### Long lists (D14): decision

Rows use `content-visibility: auto` with `contain-intrinsic-size: auto 6rem`, so rows off screen skip layout and paint but remember their rendered height, and find-in-page keeps working. This is gated on scroll anchoring that works (`html[data-scroll-anchoring=yes]`, set by the head script in `theme-script.tsx`, before first paint): WebKit answers `@supports (overflow-anchor: auto)` and a synthetic anchoring probe with yes, yet does not keep the viewport still when skipped rows above it take their real size (a 300 px scroll moved content by 479 to 683 px on the iPhone project, the jump the review saw on 38 of 40 steps), so WebKit is identified by vendor and lays every row out; `e2e/scroll.spec.ts` checks the on-screen movement of the top row across 20 scroll-up steps on all three projects. With 200 finished messages above the viewport, streaming a long reply held p95 at 16.8 ms and p99 at 33.4 ms on the throttled Pixel 7 (table above), under the 16 ms-per-frame threshold the plan set for adding `@tanstack/react-virtual`. The virtualiser is not added; the decision is revisited if a measured chat exceeds that threshold.

## 8. Rejected alternatives

- **`EventSource` for the stream** (ADR-0001): cannot POST, cannot set headers, reconnects on its own schedule; the hand-written SSE codec is 120 lines and shared by both ends.
- **WebSockets**: bidirectional transport is not needed (stop is a POST), and SSE over plain fetch resumes with the same code path as a cold load.
- **Serverless or multi-instance** (ADR-0002): a generation must outlive the response and resume must read a shared buffer; the single process keeps both in memory and the design doc records what Redis and leases would add.
- **Postgres from day one** (ADR-0003): a second service for a single-instance app; SQLite in WAL mode with Drizzle keeps the dialect swap mechanical.
- **Persisting every event**: resume is served from the in-memory buffer and, after eviction, from the message snapshot; a delta table would multiply writes for no resume benefit.
- **A parser that re-renders the whole reply per token**: the block splitter memoises finished blocks by hash so only the trailing block re-parses; measured frame times above.
- **`react-markdown`/remark**: the token-to-React renderer over `marked`'s lexer is a third of the size and never touches `innerHTML`.
- **Keeping `tailwind-merge`**: 10 kB gzipped for class conflict resolution the codebase needs in a handful of families; replaced by a 2 kB merger with tests.
- **Radix in the first paint**: menus, dialogs, popover and the picker load after first paint; the first frame needs none of them.
- **Virtualising the thread** (D14): not needed at the measured frame times; `content-visibility: auto` is enough and keeps find-in-page.
- **OAuth sign-in, anonymous demo without a user row, a shared demo account** (ADR-0004).
- **Lighthouse in CI**: the two numbers the plan asked for are read in the same Playwright run instead.

## 9. Scaling past one process

The single-process topology is deliberate for this scope. Moving to N instances would need:

- **A shared event store.** Redis streams keyed by generation id, with `XADD` for append and `XREAD` from a sequence for resume, writes batched per animation-frame-sized window (about 16 ms) to keep the command rate proportional to generations, not tokens.
- **Producer leases.** Exactly one instance may drive a generation. A lease key with a TTL, renewed by the producer every few seconds; a resume request landing on another instance reads the stream rather than starting a second producer. A lease that expires without a terminal event is the cross-instance equivalent of the boot backstop.
- **Cross-instance resume.** `GET /events?after=` becomes a stream read from Redis for any instance; the SQLite snapshot branches stay as the fallback once the stream is trimmed.
- **Stop and shutdown.** Stop publishes to the producer's control channel; shutdown hands the lease back so another instance can mark the generation interrupted.
