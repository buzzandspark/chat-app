# Self-hosting

Cadence is one Node process with a SQLite file. Run it anywhere that can run a container and mount a volume.

## Quick start

```sh
cp .env.example .env            # set ANTHROPIC_API_KEY, BETTER_AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
pnpm install
pnpm dev                        # http://localhost:3000
```

With no `ANTHROPIC_API_KEY` the app boots in replay mode: every model is served from recorded fixtures and nothing is spent.

## Docker

```sh
docker build -t cadence .
docker run -p 3000:3000 -v cadence-data:/data --env-file .env cadence
```

The container expects a volume at `/data` and listens on `PORT` (default 3000). It drains in-flight generations on `SIGTERM`; give it a stop grace period of at least 30 s.

## Railway

`railway.json` points at the Dockerfile and `/api/health`. Add a volume mounted at `/data`, set the environment variables from `.env.example`, and set the service's stop grace period to 30 s.

## Environment variables

See `.env.example`. `ADMIN_PATH_SLUG` chooses where the admin console lives; non-admins get a 404 there.

## Cost caps

Each invited user has an all-time cost cap in USD (`users.cost_cap_usd`). Over the cap, sends return `quota_exceeded` and the UI points here. Raise or clear the cap in the admin console.

A new user whose cap field is left blank gets `DEFAULT_COST_CAP_USD` (default 5). No cap is an explicit choice: the No cap box when creating, or `none` in Edit cap; the API takes the string `"none"` and refuses `null`. Spend under no cap is bounded only by your Anthropic account.

Not covered by the default:

- **The seeded admin** (`ADMIN_EMAIL`) starts with no cap: it is the operator's own account on the operator's key. Give it one with Edit cap if you want a ceiling on your own use; an account promoted to admin keeps the cap it had.
- **Users created before the default existed** keep whatever they had, including no cap; nothing is rewritten on upgrade. The console lists them as "no cap"; set a cap on each one you did not mean to leave open.
