# Self-hosting

Chat is one Node process with a SQLite file. Run it anywhere that can run a container and mount a volume.

For local development see the README.

## Docker

```sh
docker build -t chat .
docker run -p 3000:3000 -v chat-data:/data --env-file .env chat
```

The container expects a volume at `/data` and keeps its database at `/data/app.db`. Leave `DATABASE_PATH` unset (it is commented out in `.env.example`); if you set it, it must point under `/data`. A relative path such as `data/app.db` resolves inside the container's `/app`, off the volume, and the database is lost when the container is recreated. Docker's `--env-file` takes everything after `=` as the value, including a trailing `# comment`, so keep comments in `.env` on lines of their own.

In production the server refuses to start, and exits with code 1, when:

- `BETTER_AUTH_SECRET` is unset or is the `.env.example` placeholder. Generate one with `openssl rand -base64 32`.
- `BETTER_AUTH_URL` is unset. Set it to the URL users reach the app at.
- `ADMIN_PASSWORD` is `change-me` or shorter than 10 characters.
- any other variable is invalid, or boot fails, for example on a migration.

Leave `E2E` unset. It is the test harness's switch (no guest redirect, cookieless requests run as the uncapped dev user, no sign-in rate limit), and the server refuses to start with it in production unless `E2E_ALLOW_PRODUCTION=1`, which only the harness sets.

The container listens on `PORT` (default 3000). It drains in-flight generations on `SIGTERM`; give it a stop grace period of at least 30 s.

The server runs as the unprivileged `node` user (uid 1000). The container starts as root only long enough to make the database directory (the directory of `DATABASE_PATH`, `/data` by default) and the database files owned by `node`, then drops to `node`. So a volume or bind mount owned by root works as is. If you start the container with `--user` instead, it skips that step and the volume must already be writable by that user.

## Railway

`railway.json` points at the Dockerfile and `/api/health`, with 30 s of draining and up to 5 restarts on failure; confirm them in the service's settings. Add a volume mounted at `/data`, generate a domain, and set the environment variables from `.env.example`:

- `BETTER_AUTH_URL`: the generated domain, `https://<name>.up.railway.app`.
- `TRUSTED_IP_HEADER=x-real-ip`: Railway's edge sets it to the client's address.
- not `DATABASE_PATH`: the image already points it at `/data/app.db`.

Run one replica: the app is one process with SQLite. Railway mounts volumes owned by root; the entrypoint hands `/data` to `node` at boot, so you don't need `RAILWAY_RUN_UID=0`.

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

## Environment variables

See `.env.example`. `ADMIN_PATH_SLUG` chooses where the admin console lives; non-admins get a 404 there.

The client address keys rate limits and guest budgets. With `TRUSTED_IP_HEADER` set, it is that header's single address, and better-auth's sessions and sign-in limiter read the same header. Otherwise it is the `X-Forwarded-For` entry `TRUST_PROXY_HOPS` from the right, where `TRUST_PROXY_HOPS` (default 1 in production) is how many proxies sit in front of the app. An IPv6 client is keyed by its /64. A request without a readable address shares one `unknown` key with every other such request rather than going unlimited.

## Cost caps

Each invited user has an all-time cost cap in USD (`users.cost_cap_usd`). Over the cap, sends return `quota_exceeded` and the UI points here. Raise or clear the cap in the admin console.

A new user whose cap field is left blank gets `DEFAULT_COST_CAP_USD` (default 5). No cap is an explicit choice: the No cap box when creating, or `none` in Edit cap; the API takes the string `"none"` and refuses `null`. Spend under no cap is bounded only by your Anthropic account.

Not covered by the default:

- **The seeded admin** (`ADMIN_EMAIL`) starts with no cap: it is the operator's own account on the operator's key. Give it one with Edit cap if you want a ceiling on your own use; an account promoted to admin keeps the cap it had.
- **Users created before the default existed** keep whatever they had, including no cap; nothing is rewritten on upgrade. The console lists them as "no cap"; set a cap on each one you did not mean to leave open.

## Guest limits

Visitors without a session become guests: Haiku only, each with an all-time cap of `GUEST_COST_CAP_USD` (default $0.10). A guest is made only by a real page visit or the login page's Continue as a guest button; at most 10 a minute and 100 a day per address, 60 a minute and 3,000 a day overall.

Guest spend is also charged to shared daily budgets, kept in the database so they survive restarts:

| Variable | Default | Shared by |
| --- | --- | --- |
| `GUEST_IP_USD_PER_DAY` | 1 | guests from one address (an IPv4 address or an IPv6 /64) |
| `GUEST_IP48_USD_PER_DAY` | 3 | guests from one IPv6 /48 |
| `GUEST_ALL_USD_PER_DAY` | 10 | all guests |

Each budget fills with spend and drains continuously at its daily rate. While any of a guest's budgets holds more than a day's amount, the guest's new replies, forks and option rewrites get "Busy right now" with the wait, and Explore skips detection. A guest is charged to the address that created it.

The budgets are soft: replies already running when one fills finish and are charged. What can run at once bounds the overshoot:

- a guest runs at most 2 replies at once (an Explore fan-out counts as one), and guests together 20
- a guest runs at most 2 Explore calls (detection or rewrite) at once, and guests together 20
- a guest reply has `max_tokens` 8192, thinking included, as does every Explore call
- a guest prompt over `GUEST_MAX_PROMPT_TOKENS` (default 60,000, estimated at 2.5 bytes of UTF-8 a token) is refused as too long; with the default, natural text in any script stays under Haiku's long-context price tier at 100,000 tokens
- a guest sends at most 12 replies, forks or declared winners a minute and an address 40; a guest rewrites Explore options at most 10 times a minute and an address 30

With the defaults one guest reply costs at most about $0.012 and one Explore call about $0.007. Text crafted to tokenize at close to a token a byte can pass the prompt cap and reach the long-context tier; such a reply is billed exactly, at up to about $0.10. Guests together spend at most about twice `GUEST_ALL_USD_PER_DAY` in any 24 hours (a full budget, then a day of draining) and about 30 times it in a 30-day month: $20 and $300 with the defaults. Set a monthly spend limit on the API key's workspace in the Anthropic Console as a backstop. Invited users have none of these limits beyond their own cost cap.

## Trying the limits without spending

`scripts/mock-anthropic.mjs` answers the Anthropic API with canned replies and prints each request's model and `max_tokens`. It is not part of the Docker image.

```sh
MOCK_DELAY_MS=200 MOCK_INPUT_TOKENS=50000 node scripts/mock-anthropic.mjs
ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ANTHROPIC_API_KEY=mock GUEST_ALL_USD_PER_DAY=0.05 pnpm dev
```

- Chat replies replay `fixtures/claude-haiku-5-5/normal.jsonl` under the requested model.
- `MOCK_INPUT_TOKENS` and `MOCK_OUTPUT_TOKENS` set the usage every reply and Explore call reports, so each costs a known amount.
- `MOCK_DELAY_MS` waits between stream events, which keeps replies running long enough to hit the running limits.
- Explore detection finds three options and a rewrite puts the instruction in front of each prompt; `MOCK_OPTIONS=truncated` cuts either answer off at `max_tokens`.
- `MOCK_PORT` (default 4010) and `MOCK_HOST` (default 127.0.0.1) set where it listens. For the app in Docker, run it with `MOCK_HOST=0.0.0.0` and point `ANTHROPIC_BASE_URL` at `http://host.docker.internal:4010` (on Linux, also pass `--add-host=host.docker.internal:host-gateway` to `docker run`).
