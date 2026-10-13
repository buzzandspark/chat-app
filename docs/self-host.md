# Self-hosting

Chat is one Node process with a SQLite file. Run it anywhere that can run a container and mount a volume.

For local development see the README.

## Docker

```sh
docker build -t chat:local .                                                # pnpm docker:build
docker run --rm -p 127.0.0.1:3000:3000 -v chat-data:/data --env-file .env chat:local  # pnpm docker:run
```

Serve it to users through a reverse proxy on the same host, such as Caddy (`reverse_proxy 127.0.0.1:3000`) or nginx (`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`), and set `TRUST_PROXY_HOPS=1`. The proxy is required, not just for TLS: rate limits, guest budgets and the sign-in limiter key on the client address, which is the `X-Forwarded-For` entry the proxy adds. Reached directly, the app sees whatever `X-Forwarded-For` the client sent, so a client picks its own address for every limit. That is why the port is published on `127.0.0.1` only; keep it that way.

`NEXT_PUBLIC_*` values are baked in at build time, so pass them as build args (`docker build --build-arg NEXT_PUBLIC_SENTRY_DSN=… -t chat:local .`); `--env-file` doesn't reach them.

Set `ANTHROPIC_API_KEY`. Without it the server runs in replay mode with canned replies, and only the boot log says so.

The container expects a volume at `/data` and keeps its database at `/data/app.db`. Leave `DATABASE_PATH` unset (it is commented out in `.env.example`); if you set it, it must point under `/data`. A relative path such as `data/app.db` resolves inside the container's `/app`, off the volume, and the database is lost when the container is recreated. Docker's `--env-file` takes everything after `=` as the value, including a trailing `# comment`, so keep comments in `.env` on lines of their own.

In production the server refuses to start, and exits with code 1, when:

- `BETTER_AUTH_SECRET` is unset, shorter than 16 characters, or the `.env.example` placeholder. Generate one with `openssl rand -base64 32`.
- `BETTER_AUTH_URL` is unset. Set it to the URL users reach the app at.
- `ANTHROPIC_API_KEY` is unset and `REPLAY_MODE` is not `1`. Replay mode serves scripted replies, so a deployment asks for it explicitly.
- `ADMIN_PASSWORD` is `change-me` or shorter than 10 characters.
- any other variable is invalid, or boot fails, for example on a migration.

It starts but logs a warning when neither `TRUSTED_IP_HEADER` nor `TRUST_PROXY_HOPS` is set.

`ADMIN_PASSWORD` applies only when the admin account is created, so replace the placeholder before first boot.

Leave `E2E` unset. It is the test harness's switch (no guest redirect, cookieless requests run as the uncapped dev user, no sign-in rate limit), and the server refuses to start with it in production unless `E2E_ALLOW_PRODUCTION=1`, which only the harness sets.

The container listens on `PORT` (default 3000). It drains in-flight generations on `SIGTERM`; give it a stop grace period of at least 30 s.

The server runs as the unprivileged `node` user (uid 1000). The container starts as root only long enough to make the database directory (the directory of `DATABASE_PATH`, `/data` by default) and the database files owned by `node`, then drops to `node`. So a volume or bind mount owned by root works as is. If you start the container with `--user` instead, it skips that step and the volume must already be writable by that user.

## Railway

Railway builds the Dockerfile. New Railway services don't read `railway.json`, so set its values in the service's settings: health check path `/api/health`, 30 s of draining, and restart on failure up to 5 times. Add a volume mounted at `/data`, generate a domain, and set the environment variables from `.env.example` (not `DATABASE_PATH`: the image already points it at `/data/app.db`):

- `BETTER_AUTH_URL`: the generated domain, `https://<name>.up.railway.app`.
- `TRUSTED_IP_HEADER=x-real-ip`: Railway's edge sets it to the client's address.
- not `DATABASE_PATH`: the image already points it at `/data/app.db`.

The database is the only copy of every chat; see [Backups](#backups). Run one replica: the app is one process with SQLite. Railway mounts volumes owned by root; the entrypoint hands `/data` to `node` at boot, so you don't need `RAILWAY_RUN_UID=0`.

After the first deploy, check that a client can't choose its own address. Make a guest with forged headers:

```sh
curl -s -o /dev/null -w '%{redirect_url}\n' https://<name>.up.railway.app/api/guest \
  -H 'Sec-Fetch-Mode: navigate' -H 'Sec-Fetch-Dest: document' \
  -H 'X-Real-IP: 203.0.113.7' -H 'X-Forwarded-For: 203.0.113.7'
```

It prints `…/c` when it made a guest (`…/login` means the guest creation limit refused it).

Then open a shell in the container with `railway ssh` and read the newest guest and its session:

```sh
node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/data/app.db', { readOnly: true }); console.log(db.prepare('select u.budget_keys, s.ip_address from users u join sessions s on s.user_id = u.id where u.role = ? order by s.created_at desc limit 1').get('guest'))"
```

Both must show your own address, not `203.0.113.7`. If they show the forged one, unset `TRUSTED_IP_HEADER`, so the address comes from `X-Forwarded-For`, `TRUST_PROXY_HOPS` entries from the right (default 1), and run the check again.

## Backups

Copying `app.db` while the server runs can miss recent writes, which sit in `app.db-wal` until a checkpoint. Use SQLite's online backup instead, then copy the file off the host:

```sh
docker exec -u node <container> node -e "const s = require('node:sqlite'); s.backup(new s.DatabaseSync('/data/app.db'), '/data/backup.db').then(() => console.log('ok'))"
docker cp <container>:/data/backup.db ./app-$(date +%F).db
```

On Railway, volume backups (the volume's Backups tab) need the Pro plan, and wiping the volume deletes them. The `node -e` command also runs in `railway ssh`; keep the copy somewhere other than the volume.

## Environment variables

See `.env.example`. `ADMIN_PATH_SLUG` chooses where the admin console lives; non-admins get a 404 there.

The client address keys rate limits and guest budgets. With `TRUSTED_IP_HEADER` set, it is that header's single address. Otherwise it is the `X-Forwarded-For` entry `TRUST_PROXY_HOPS` from the right, where `TRUST_PROXY_HOPS` (default 1 in production) is how many proxies sit in front of the app. Production needs at least one: with `TRUST_PROXY_HOPS=0` every client shares one key. The proxy passes the same address to better-auth's sessions and sign-in limiter. An IPv6 client is keyed by its /64. A request without a readable address shares one `unknown` key with every other such request rather than going unlimited.

## Cost caps

Each invited user has an all-time cost cap in USD (`users.cost_cap_usd`). A send starts if its estimated input fits under the cap beside what the user's running replies have used; replies stop once spend reaches the cap, so it can be passed by a little. Each user runs at most 3 replies at once (Explore forks not counted) and gets "Busy right now" past that. Raise or clear the cap in the admin console.

A new user whose cap field is left blank gets `DEFAULT_COST_CAP_USD` (default 5). No cap is an explicit choice: the No cap box when creating, or `none` in Edit cap; the API takes the string `"none"` and refuses `null`. Spend under no cap is bounded only by your Anthropic account.

Not covered by the default:

- **The seeded admin** (`ADMIN_EMAIL`) starts with no cap: it is the operator's own account on the operator's key. Give it one with Edit cap if you want a ceiling on your own use; an account promoted to admin keeps the cap it had.
- **Accounts with no cap** show as "no cap" in the console; set a cap on each one you did not mean to leave open.

## Guest limits

Visitors without a session become guests: Haiku only, each with an all-time cap of `GUEST_COST_CAP_USD` (default $0.10). A guest is made only by a real page visit or the login page's Continue as a guest button; at most 10 a minute and 100 a day per address, 60 a minute and 3,000 a day overall.

Guest spend is also charged to shared daily budgets, kept in the database so they survive restarts:

| Variable | Default | Shared by |
| --- | --- | --- |
| `GUEST_IP_USD_PER_DAY` | 1 | guests from one address (an IPv4 address or an IPv6 /64) |
| `GUEST_IP48_USD_PER_DAY` | 3 | guests from one IPv6 /48 |
| `GUEST_ALL_USD_PER_DAY` | 100 | all guests |

Each budget fills with spend and drains continuously at its daily rate. A guest is charged to the address that created it. While a guest call runs it holds its worst-case cost (its prompt at the cache-write rate plus every output token it may use) against the guest's cap and each of its budgets, and a stopped or interrupted reply is never charged more output than that, so neither the cap nor a budget is exceeded. The one exception is a reply cut off by a crash or SIGKILL, estimated at boot from its saved text: it can pass its hold by under a cent. A reply, fork or option rewrite that does not fit gets "Busy right now" with the wait (a budget) or the spent-budget message (the cap), and Explore skips detection.

- a guest runs at most 2 replies at once, and guests together 50; a fork of an Explore fan-out takes half a reply's place, and forks past that wait their turn
- a guest runs at most 2 Explore calls (detection or rewrite) at once, and guests together 50
- a guest reply has `max_tokens` 8192, thinking included, as does every Explore call
- a guest prompt whose size could put it over `GUEST_MAX_PROMPT_TOKENS` is counted exactly before it is sent and refused as too long over it (default 60,000, at most 90,000), so no guest request reaches Haiku's long-context price tier at 100,000 tokens
- an address whose guest sends an over-long prompt of machine payload (under 1.2 bytes of UTF-8 a token, such as base64) has its budget filled to two days' worth, which refuses its guests for about a day
- a guest sends at most 12 replies, forks or declared winners a minute and an address 40; a guest rewrites Explore options at most 10 times a minute and an address 30

With the defaults one guest reply holds at most about $0.012 and one Explore call about $0.007. Guests together spend at most about twice `GUEST_ALL_USD_PER_DAY` in any 24 hours (a full budget, then a day of draining) and about 30 times it in a 30-day month: $200 and $3,000 with the defaults. Set a monthly spend limit on the API key's workspace in the Anthropic Console as a backstop. Invited users have none of these limits beyond their own cost cap and running limit.

## Trying the limits without spending

`scripts/mock-anthropic.mjs` answers the Anthropic API with canned replies and prints each request's model and `max_tokens`. It is not part of the Docker image.

```sh
MOCK_DELAY_MS=200 MOCK_INPUT_TOKENS=50000 pnpm exec tsx scripts/mock-anthropic.mjs
ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ANTHROPIC_API_KEY=mock GUEST_ALL_USD_PER_DAY=0.05 pnpm dev
```

- Chat replies stream the Haiku `normal` scenario from `src/relay/scenarios.ts` under the requested model.
- `MOCK_INPUT_TOKENS` and `MOCK_OUTPUT_TOKENS` set the usage every reply and Explore call reports, so each costs a known amount. `MOCK_INPUT_TOKENS` is also the count a guest's prompt gets from `count_tokens`; unset, the prompt is counted at 2.5 bytes a token.
- `MOCK_DELAY_MS` waits between stream events, which keeps replies running long enough to hit the running limits.
- Explore detection finds three options and a rewrite puts the instruction in front of each prompt; `MOCK_OPTIONS=truncated` cuts either answer off at `max_tokens`.
- `MOCK_PORT` (default 4010) and `MOCK_HOST` (default 127.0.0.1) set where it listens. For the app in Docker, run it with `MOCK_HOST=0.0.0.0` and point `ANTHROPIC_BASE_URL` at `http://host.docker.internal:4010` (on Linux, also pass `--add-host=host.docker.internal:host-gateway` to `docker run`).
