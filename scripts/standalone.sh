#!/usr/bin/env sh
# Runs the standalone build as the Dockerfile does (D1): assets copied next to server.js,
# manual signal handling so our SIGTERM drain runs.
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .next/standalone/server.js ]; then
  echo "No standalone build found; run \`pnpm build\` first." >&2
  exit 1
fi
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public .next/standalone/public
mkdir -p .next/standalone/src/db
rm -rf .next/standalone/src/db/migrations .next/standalone/fixtures
cp -r src/db/migrations .next/standalone/src/db/migrations
cp -r fixtures .next/standalone/fixtures
mkdir -p data
export DATABASE_PATH="${DATABASE_PATH:-$PWD/data/app.db}"
case "$DATABASE_PATH" in /*) ;; *) export DATABASE_PATH="$PWD/$DATABASE_PATH" ;; esac
# Local harness runs (E2E=1) get a fixed auth secret; production must set its own.
if [ "${E2E:-}" = "1" ]; then
  export BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-e2e-local-secret-not-for-production-0123456789}"
  export BETTER_AUTH_URL="${BETTER_AUTH_URL:-http://${HOSTNAME:-127.0.0.1}:${PORT:-3000}}"
fi
export NEXT_MANUAL_SIG_HANDLE=true
exec node .next/standalone/server.js
