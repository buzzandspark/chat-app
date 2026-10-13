# ADR-0001: Transport and idempotent send

Status: accepted · Date: 2026-10-06

## Context

A chat client on a phone loses its connection constantly: the tab is backgrounded, the radio hands over between cells, the user walks into a lift. The transport has to make one thing true no matter what the network does: **one send produces exactly one generation**, and the client can always catch up on what it missed.

## Decision

- `POST /api/chat` carries client-generated UUIDv7 `generationId` and `messageId`. The server writes the user message and a `generations` row (status `running`) before calling upstream, and is idempotent on `generationId`: a duplicate POST attaches to the existing generation and streams from the buffer instead of starting again.
- The response streams Server-Sent Events directly over `fetch` with a `ReadableStream` and a hand-written decoder. The encoder and decoder share one module (`src/relay/sse.ts`). The first event is `started { generationId, seq: 0 }`.
- `GET /api/generations/:id/events?after=<seq>` is the single resume path, used after a POST failure (`after=0`), a dropped connection, or returning from the background. Its branches are:
  - buffer present: stream buffered events from `after`, then live events;
  - no buffer, row `running`: the process restarted; the row is marked `interrupted` and a `snapshot` control event carries the saved partial content and `status: "interrupted"`;
  - no buffer, row terminal: the buffer was evicted; a `snapshot` carries the saved message and its terminal status;
  - no row: the server never received the POST; the client re-POSTs with the same ids.
- Control events (`snapshot`, and any terminal event produced by the GET path rather than the producer) carry `seq: null` and bypass sequence dedupe. Snapshot application depends on status: `done` and `refused` replace local state; `interrupted` or `stopped` keeps local text when it extends the snapshot (the saved partial can be up to 2 s behind) and applies only the status, so visible text never shrinks.

## Alternatives rejected

- **`EventSource`.** Cannot POST, cannot set headers, and its built-in reconnect would fight our backoff and resume logic.
- **WebSockets.** Bidirectional transport is not needed (stop is a separate POST), and SSE over plain HTTP reconnects and resumes with plain fetch semantics and no upgrade dance through proxies.
- **Server-generated ids.** The server would have to hand an id back before the client could retry safely, which reintroduces the window where a retry duplicates a send.

## Consequences

Every event in the system carries `(generationId, seq)`, which makes replay, dedupe, and the fixture harness share one vocabulary. Sequence numbers are the index into the in-memory buffer (ADR-0002), so resume is an array slice.
