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

_pending (step 2)_

## 5. Reliability

_pending (step 3)_

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
