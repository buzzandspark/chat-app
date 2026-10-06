# Cadence

A streaming chat client built for phones first. One Node process, SQLite, a replay harness that makes every failure mode reproducible.

- `docs/design-doc.md`: architecture and decisions.
- `docs/adr/`: transport, topology, persistence, identity.
- `docs/self-host.md`: running it yourself.
- `docs/comparison.md`: hand-measured scenarios against the Claude desktop app.

## Develop

```sh
pnpm install
cp .env.example .env
pnpm dev
```

No `ANTHROPIC_API_KEY`? The app boots in replay mode and every scenario still runs.

## Check

```sh
pnpm typecheck && pnpm lint && pnpm test
pnpm build && pnpm size
pnpm e2e --project=pixel7      # phone first; then --project=iphone14 --project=desktop
pnpm test:shutdown             # SIGTERM and SIGKILL mid-stream against the built server
pnpm screenshots <label>       # design-review frames, phone first, into docs/design/<label>/
```
