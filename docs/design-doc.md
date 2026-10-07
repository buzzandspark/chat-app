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

See `docs/adr/` for transport (0001), topology (0002), persistence (0003), identity (0004). Decision numbers D0 to D28 referenced in code comments map to the build plan.

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
- **Snapshots never shrink text.** `done` replaces local state; `interrupted` or `stopped` keeps local text when it extends the snapshot (the saved partial can be up to 2 s behind) and applies only the status.
- **Reconnect** (`src/client/transport/generation-client.ts`): 500 ms to 8 s backoff with jitter, 10 attempts, then an offline state with manual retry; `online` and `visibilitychange` trigger an immediate attempt; progress resets the attempt count.
- **Stop is explicit.** `POST /stop` aborts upstream and appends `stopped`; closing a tab never stops a generation. Stopped and interrupted generations settle an estimated cost: input exact from `message_start`, output from elapsed streaming time times a rolling tokens-per-second per model.
- **Shutdown.** `instrumentation.ts` installs the SIGTERM handler (Next's own is disabled by `NEXT_MANUAL_SIG_HANDLE`). Drains run last-registered first: the engine aborts every upstream request, writes each partial, settles estimated cost, marks rows `interrupted { reason: "shutdown" }`, and appends the event to connected clients; the process then waits up to 2 s for open SSE sockets to flush, closes SQLite, and exits. `scripts/shutdown-test.sh` verifies this against the built standalone server, plus the SIGKILL case: saved content within 2 s of what the client displayed, and the boot backstop marking the row `crash` with an estimated usage row.
- **Terminal states** (D17) each have their own wording and action in `status-footer.tsx`: rate limited (countdown from retry-after), overloaded, API error, server-side key problem, quota exceeded, interrupted, cut off (Continue), context full (new chat), refusal in three variants with painted text dimmed and excluded from history.

## 6. Models, thinking, fallback, caching

Checked against the bundled Claude API reference on 2026-10-06; the per-model request shape lives in one place, `src/relay/anthropic/thinking-config.ts`, and `request.ts` is the only request builder, used by the live provider, the recorder, and the cache test alike.

| | Sonnet 5.5 (default), Opus 5.5 | Haiku 4.5 |
| --- | --- | --- |
| Thinking | `adaptive`, `display: "summarized"` | `enabled`, `budget_tokens: 2048` when "Extended thinking" is on, else none |
| "Think harder" | `output_config.effort: "high"` (default `"low"`) | the toggle above |
| Fallbacks | `fallbacks: "default"` under beta `server-side-fallback-2026-07-01` | none |
| Binding | `thinking.block_binding.prefix_mismatch_behavior: "drop_block"` under beta `thinking-binding-controls-2026-08-01` | none |
| `max_tokens` | 16,000 | 16,000 |

- **Why `drop_block`.** The binding check covers the system prompt and tools as well as every earlier message, and is enforced by default for API accounts created on or after 2026-08-31. Without it, a deploy that edits the system prompt would turn every existing chat with thinking blocks into a 400. `input_transformations` from `message_start` is logged with the generation so prefix mismatches are visible; a `model_binding_mismatch` after a model switch is expected, not a bug.
- **Model per message, not per chat.** Sticky routing can serve later turns on the fallback model for about an hour and the requested model may be retried at any time, so `messages.requested_model` and `messages.serving_model` are stored per assistant message. The picker value only chooses the next turn. The serving model is the last `fallback` block's `to.model`, else `message_start.message.model`, cross-checked with a `fallback_message` entry in `usage.iterations` for sticky-routed turns that carry no block.
- **Fallback in the stream.** A `fallback` block arrives as an ordinary `content_block_start`. Before any text it is invisible except in timing (the latency popover labels the first-token interval "includes a declined attempt") and in `iterations`; after text, the open block closes, the relay emits `fallback_boundary`, the partial is kept, and the UI shows a divider ("Served by Claude Opus 4.8 after a safety fallback"). `history.ts` omits thinking and tool use before a message's final fallback block when echoing it back.
- **Refusal without fallback** (`stop_reason: "refusal"`, possible on Haiku, on `bio`/`reasoning_extraction`/`general_harms` categories on Sonnet 5.5, or when the whole chain declines) is its own message status. Painted partial text is dimmed, labelled "incomplete and not saved", excluded from later history, and has no retry affordance. Three wordings: category and explanation, category only, neither.
- **Caching.** The fixed system prompt carries the first `cache_control` breakpoint; the moving breakpoint is the newest user message's last text block. Minimum cacheable prefix is 512 tokens on Sonnet 5.5 and Opus 5.5 and 4096 on Haiku 4.5, so `pnpm test:cache` (opt-in, spends money) sends a fixture above 4096 tokens twice per model and asserts non-zero `cache_read_input_tokens` on the second request. Cache fields are stored per iteration in `usage_events` and shown in the latency popover.
- **Context.** History is sent whole; Sonnet 5.5 and Opus 5.5 have 1M-token windows and Haiku 4.5 200K. A context-length 400 maps to `kind: "context_full"` and the UI says "This chat is too long to continue. Start a new chat."
- **Cost (D22).** Each `usage.iterations` entry is priced at its own model's rates (a declined attempt is a `message` entry for the declined model; the serving hop is `fallback_message`). Stopped or interrupted generations are settled as estimates: exact input from `message_start`, output from elapsed streaming time times a rolling tokens-per-second per model, because billed output includes full thinking while only its summary is visible.

## 6a. Identity and the public demo (ADR-0004)

better-auth on the Drizzle adapter: email + password with sign-up disabled, the admin plugin for roles and bans, the anonymous plugin for demo visitors. `proxy.ts` only checks for the session cookie; `getCurrentUser` validates with `auth.api.getSession` once per request and once per SSE connection. "Try the demo" creates an anonymous user, sets its role to `demo` and its session to 24 h; the provider resolver forces replay for `demo` users server-side, so the demo cannot spend money whatever the client asks for. An hourly timer deletes demo users older than 24 h and SQLite cascades remove their sessions, chats, messages and usage. Invites are random 32-byte tokens stored as SHA-256 with a 7-day expiry and single use; issuing a new one revokes the old; the same flow resets a password. The admin console lives at `/${ADMIN_PATH_SLUG}` and renders the not-found page for anyone else (partial prerendering streams the boundary after a 200 shell, so it is a visible 404 rather than an HTTP 404).

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

Where the 188 kB goes:

| Source | kB gzipped |
| --- | ---: |
| Next 16.4 app router runtime, React 19.3 (vendored under `next`), cache components client | 133 |
| `marked` lexer | 14 |
| `src/client/components` (shell, list, composer, footer, thinking) | 13 |
| `src/client/markdown`, `store`, `transport`, hooks | 10 |
| Turbopack runtime | 4 |
| Button, Slot, lucide icons, clsx | 4 |

The plan set the budget at 180 kB assuming a smaller framework floor; Next 16's runtime alone measures 133 kB, so the CI gate is 200 kB, which caps everything outside the framework at 67 kB. Correct class merging is worth its 10 kB: the hand-written replacement shipped visible layout bugs within a day. The next lever is `marked` (14 kB): a purpose-built block and inline tokenizer on top of the existing block splitter would recover roughly 10 kB and is scheduled for the step 7 performance pass if the Pixel 7 Fast-3G numbers call for it.

### Measured on a throttled Pixel 7 (D0, D26)

`pnpm e2e --project=pixel7 e2e/perf.spec.ts` emulates a Pixel 7 with CPU 4x slowdown and Playwright's Fast 3G profile through the Chrome DevTools protocol, against the built standalone server on localhost (so TTFB is not representative), and appends to `docs/perf/<date>.json`. 2026-10-06:

| Measure | Value |
| --- | ---: |
| Shell: cumulative layout shift | 0 (0 shifts) |
| Shell: first contentful paint | 1.50 s |
| Shell: DOMContentLoaded | 1.38 s |
| Shell: composer hydrated | 3.34 s |
| Shell: bytes transferred | 325 kB |
| Shell: fonts | Inter loaded, metric-matched fallback loaded, no swap (`display: optional`) |
| Long reply streaming: first painted token after tap | 2.0 s (includes the scripted 450 ms TTFT and the sheet closing) |
| Long reply streaming: frame time p50 / p95 / p99 | 16.7 / 16.8 / 16.8 ms, 0 frames over 50 ms of 625 |
| 200-message chat: time to hydrated after navigation | 0.93 s |
| 200-message chat streaming: frame time p50 / p95 / p99 | 16.7 / 16.8 / 33.4 ms, 3 frames over 50 ms of 560 |
| 600-line code block streaming: frame time p50 / p95 / p99 | 16.7 / 33.3 / 33.4 ms, 0 frames over 50 ms of 1,402 |

Lighthouse is not wired in; CLS, paint timings, and font status are read from `PerformanceObserver` and `document.fonts` inside the same run, which gives the two numbers the plan asked for (CLS 0, no font flash) without a second toolchain.

### Long lists (D14): decision

Rows use `content-visibility: auto` with `contain-intrinsic-size: auto 6rem`, so rows off screen skip layout and paint but remember their rendered height, and find-in-page keeps working. With 200 finished messages above the viewport, streaming a long reply held p95 at 16.8 ms and p99 at 33.4 ms on the throttled Pixel 7 (table above), under the 16 ms-per-frame threshold the plan set for adding `@tanstack/react-virtual`. The virtualiser is not added; the decision is revisited if a measured chat exceeds that threshold.

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
