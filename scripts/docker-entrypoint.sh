#!/bin/sh
# Container entrypoint. Volumes can mount root-owned, so as root chown the DB directory to `node` and
# drop to it; each step `exec`s so Node is PID 1 and receives SIGTERM for the drain.
set -eu
if [ "$(id -u)" = "0" ]; then
  db="${DATABASE_PATH:-/data/app.db}"
  if [ "$db" != ":memory:" ]; then
    dir="$(dirname "$db")"
    mkdir -p "$dir"
    # Never chown / (DATABASE_PATH=/app.db). `node` can plant symlinks here, so links are skipped and
    # `-h` keeps chown on the name itself if a file is swapped for a link after the test.
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
