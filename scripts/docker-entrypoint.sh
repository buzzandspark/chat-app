#!/bin/sh
# Container entrypoint (D1). A volume mounted over /data at runtime keeps its own ownership, not the
# image's chown: Railway's volumes mount owned by root, so the `node` user couldn't open the
# database. Started as root, give the database directory to `node` and drop to it; started as
# anyone else (`--user`), just run. Each step `exec`s, so Node ends up as PID 1 and receives SIGTERM
# directly for the drain (D3).
set -eu
if [ "$(id -u)" = "0" ]; then
  db="${DATABASE_PATH:-/data/app.db}"
  if [ "$db" != ":memory:" ]; then
    dir="$(dirname "$db")"
    mkdir -p "$dir"
    # Never chown the filesystem root (DATABASE_PATH=/app.db); only the directory and the database's own files.
    # `node` can write in that directory, so any of these names may be a symlink it planted (say
    # app.db-journal -> /usr/local/bin/cadence-entrypoint). A symlink is skipped, never followed, and
    # `-h` keeps chown on the name itself even if a file is swapped for a link after the test.
    if [ "$dir" != "/" ]; then
      chown -h node:node "$dir"
      for f in "$db" "$db-wal" "$db-shm" "$db-journal"; do
        if [ -L "$f" ]; then continue; fi
        if [ -e "$f" ]; then chown -h node:node "$f"; fi
      done
    fi
  fi
  export HOME=/home/node
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
