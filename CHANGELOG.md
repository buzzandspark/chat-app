# Changelog

All notable changes, newest first. Dates are the day the work landed.

## 2026-10-06

- Reliability (step 3): SIGTERM drain in last-registered-first order with a flush wait for open SSE sockets; boot backstop settles an estimated cost for orphaned generations; `scripts/shutdown-test.sh` verifies SIGTERM and SIGKILL mid-stream against the built server; the simulated dropped connection ends the response cleanly instead of erroring the socket.
- Streaming core and harness (step 2): relay engine (idempotent start, resume branches, explicit stop, drain, 2 s partial persistence, per-iteration cost settlement), Anthropic stream normalizer and accumulator (text, thinking, pre-output and mid-stream fallback, sticky routing, refusal, error events), history and request builders, providers (live, replay, scripted, recording) with generated per-model fixtures, SSE codec, route handlers, client store with per-frame batching and seq dedupe, transport with backoff resume and re-POST on 404, phone-first chat UI, markdown block splitter with idle-time highlighting, 83 unit tests and 14 Playwright specs on Pixel 7, iPhone 14 and desktop. First design-review screenshots in `docs/design/step2/`.
- Scaffold: Next.js 16 (App Router, standalone output, cache components), strict TypeScript, Tailwind v4 with phone-first tokens, shadcn on Radix, ESLint, Vitest, Playwright (Pixel 7 default), size-limit on the chat route, Dockerfile on Debian slim, CI, Drizzle SQLite schema and first migration, boot instrumentation with the orphaned-generation backstop and a SIGTERM drain registry, ADR-0001 to ADR-0004, doc skeletons.
