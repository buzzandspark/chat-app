# ADR-0002: Topology, one long-lived Node process

Status: accepted · Date: 2026-10-06

## Context

The relay has to keep a generation alive after the HTTP response that started it has gone away, buffer its events for resume, and drain cleanly on deploy. That rules out request-scoped serverless functions and makes the question: how many processes, and where does state live?

## Decision

Next.js runs as a single Node server (`node server.js` from the `output: "standalone"` build) on any container host, e.g. Railway.

- **Dockerfile**: multi-stage, build and runtime stages both on `node:24-bookworm-slim`. `better-sqlite3` ships prebuilt glibc binaries, so Alpine (musl) would force a source build on every install; the build stage still installs `python3`, `make`, and `g++` as a fallback. The runtime stage copies the standalone output, whose file trace includes `better-sqlite3` together with the `bindings` package it loads its binary through. It sets `NEXT_MANUAL_SIG_HANDLE=true` and runs `CMD ["node", "server.js"]` in exec form so Node receives the signal directly.
- **Database**: SQLite via Drizzle and `better-sqlite3`, one file (`data/app.db` locally, a volume mounted at `/data` in the container), WAL mode, migrations run at boot (`src/server/boot.ts`).
- **Relay**: `src/relay/` is a plain module with no framework imports. Route handlers call into it; tests call the engine directly. A generation runs as a detached promise that outlives the HTTP response. The event buffer is an in-process `Map`.
- **Shutdown**: our handler (`src/server/shutdown.ts`) stops accepting new generations, aborts upstream requests, writes each partial, settles estimated cost, marks rows `interrupted { reason: "shutdown" }`, notifies connected clients, closes SQLite, and exits. `railway.json` sets Railway's stop grace period to 30 s (`drainingSeconds`).

## Alternatives rejected

- **Serverless (Vercel functions).** A generation cannot outlive the response, so a dropped client would kill the upstream call, and there is no shared buffer for resume without an external store on every request.
- **Postgres from day one.** Adds a network hop and a second service to run for a single-instance app. SQLite in WAL mode handles this write volume comfortably; the schema is Drizzle so a Postgres dialect swap is mechanical.
- **Multiple instances behind a load balancer.** Resume would need sticky routing or a shared event store. The design doc's "Scaling past one process" section describes the Redis event store, producer leases, and cross-instance resume that would be needed; the single-process topology is deliberate for this scope.

## Consequences

One process means one event buffer and one database connection: simple, fast, and honest about its ceiling. A deploy is a drain, not a cutover, so the SIGTERM path is a first-class feature with its own tests.
