#!/usr/bin/env sh
# Mirrors the Dockerfile layout so local/e2e runs exercise the same server.js
# that production runs (D1). Copies static assets next to the standalone output,
# then starts it with manual signal handling so our SIGTERM drain runs.
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .next/standalone/server.js ]; then
  echo "No standalone build found; run \`pnpm build\` first." >&2
  exit 1
fi
mkdir -p .next/standalone/.next
rm -rf .next/standalone/.next/static .next/standalone/public
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
mkdir -p .next/standalone/src/db
rm -rf .next/standalone/src/db/migrations .next/standalone/fixtures
cp -r src/db/migrations .next/standalone/src/db/migrations
cp -r fixtures .next/standalone/fixtures
mkdir -p data
export DATABASE_PATH="${DATABASE_PATH:-$PWD/data/app.db}"
case "$DATABASE_PATH" in /*) ;; *) export DATABASE_PATH="$PWD/$DATABASE_PATH" ;; esac
export NEXT_MANUAL_SIG_HANDLE=true
exec node .next/standalone/server.js
