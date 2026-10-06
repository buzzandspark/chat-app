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

_pending (step 4)_

## 7. Performance

_pending (step 7)_

## 8. Rejected alternatives

Collected from the ADRs; _pending_ expansion.

## 9. Scaling past one process

The single-process topology is deliberate for this scope. Moving to N instances would need:

- **A shared event store.** Redis streams keyed by generation id, with `XADD` for append and `XREAD` from a sequence for resume, writes batched per animation-frame-sized window (about 16 ms) to keep the command rate proportional to generations, not tokens.
- **Producer leases.** Exactly one instance may drive a generation. A lease key with a TTL, renewed by the producer every few seconds; a resume request landing on another instance reads the stream rather than starting a second producer. A lease that expires without a terminal event is the cross-instance equivalent of the boot backstop.
- **Cross-instance resume.** `GET /events?after=` becomes a stream read from Redis for any instance; the SQLite snapshot branches stay as the fallback once the stream is trimmed.
- **Stop and shutdown.** Stop publishes to the producer's control channel; shutdown hands the lease back so another instance can mark the generation interrupted.
