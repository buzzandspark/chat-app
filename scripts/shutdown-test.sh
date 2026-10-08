#!/usr/bin/env sh
# D3 check against the built standalone server: SIGTERM mid-stream drains (partial saved, estimated
# usage, client gets `interrupted`); SIGKILL loses at most 2 s and the next boot's backstop marks it.
set -eu
cd "$(dirname "$0")/.."
PORT=${PORT:-3126}
BASE="http://127.0.0.1:$PORT"
DB="$PWD/data/shutdown-test.db"
OUT=${OUT:-"$PWD/data/shutdown-test"}

uuid() { node -e 'console.log(crypto.randomUUID())'; }
fail() { echo "FAIL: $1"; exit 1; }
# Whatever this run started dies with it, pass or fail: a server left on the port would answer the
# next run's health check with a deleted DB still open, and that run would test the wrong process.
SERVER_PID=""; CURL_PID=""
cleanup() {
  [ -n "$CURL_PID" ] && kill "$CURL_PID" 2>/dev/null || true
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null || true
    for i in $(seq 1 20); do kill -0 "$SERVER_PID" 2>/dev/null || return 0; sleep 0.5; done
    kill -KILL "$SERVER_PID" 2>/dev/null || true
  fi
  return 0
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# The listener only; a bare `lsof -ti :PORT` also lists client sockets such as our own curl.
pid() { lsof -ti tcp:"$PORT" -sTCP:LISTEN | head -1; }
if [ -n "$(pid)" ] || curl -s -o /dev/null -m 2 "$BASE/"; then fail "port $PORT is already in use"; fi
mkdir -p "$OUT"
rm -f "$DB" "$DB-wal" "$DB-shm"
boot() {
  # standalone.sh execs node, so $! is the server itself.
  PORT=$PORT HOSTNAME=127.0.0.1 REPLAY_MODE=1 E2E=1 DATABASE_PATH="$DB" sh scripts/standalone.sh > "$OUT/server-$1.log" 2>&1 &
  SERVER_PID=$!
  for i in $(seq 1 60); do
    kill -0 "$SERVER_PID" 2>/dev/null || break
    if curl -fsS "$BASE/api/health" >/dev/null 2>&1; then
      [ "$(pid)" = "$SERVER_PID" ] || fail "port $PORT is answered by pid $(pid), not the server this run started ($SERVER_PID)"
      return 0
    fi
    sleep 0.5
  done
  echo "server did not start"; cat "$OUT/server-$1.log"; exit 1
}
start_stream() {
  G=$(uuid); C=$(uuid); U=$(uuid); A=$(uuid)
  curl -sS -N -m 60 -X POST "$BASE/api/chat" -H 'content-type: application/json' \
    -d "{\"chatId\":\"$C\",\"generationId\":\"$G\",\"messageId\":\"$U\",\"assistantMessageId\":\"$A\",\"text\":\"$1\",\"model\":\"claude-sonnet-5-5\",\"scenario\":\"$2\"}" > "$OUT/$3.sse" 2>/dev/null &
  CURL_PID=$!
}
query() { node -e "const D=require('better-sqlite3');const d=new D('$DB',{readonly:true});console.log(JSON.stringify(d.prepare(process.argv[1]).all()))" "$1"; }

echo "== 1. SIGTERM mid-stream =="
boot sigterm
start_stream "sigterm test" slow_tokens sigterm
sleep 4
SERVER=$SERVER_PID; T0=$(date +%s)
kill -TERM "$SERVER"
for i in $(seq 1 60); do kill -0 "$SERVER" 2>/dev/null || break; sleep 0.5; done
kill -0 "$SERVER" 2>/dev/null && fail "process still alive after 30s"
T1=$(date +%s); echo "exited in $((T1 - T0))s"
wait $CURL_PID 2>/dev/null || true
# One `data: {json}` line per event (src/relay/sse.ts): the type lives in the JSON, not an `event:` line.
grep -q '^data: .*"type":"interrupted"' "$OUT/sigterm.sse" || fail "client did not receive interrupted event"
grep '^data: .*"type":"interrupted"' "$OUT/sigterm.sse" | grep -q '"reason":"shutdown"' || fail "interrupted reason is not shutdown"
GEN=$(query "select status, interrupted_reason reason from generations")
echo "generation: $GEN"
echo "$GEN" | grep -q '"status":"interrupted","reason":"shutdown"' || fail "generation row not interrupted/shutdown"
MSG=$(query "select status, length(content) len from messages where role='assistant'")
echo "message: $MSG"
echo "$MSG" | grep -q '"status":"interrupted"' || fail "message row not interrupted"
# Content is a JSON array of blocks, so length 2 is `[]`; anchored so 245 does not match.
echo "$MSG" | grep -q '"len":2[,}]' && fail "partial content was not persisted"
USAGE=$(query "select estimated, output_tokens from usage_events")
echo "usage: $USAGE"
echo "$USAGE" | grep -q '"estimated":1' || fail "no estimated usage row"
echo "SIGTERM: ok"

echo "== 2. SIGKILL mid-stream, then boot backstop =="
rm -f "$DB" "$DB-wal" "$DB-shm"
boot sigkill
start_stream "sigkill test" slow_tokens sigkill
sleep 6
SERVER=$SERVER_PID
kill -KILL "$SERVER"
sleep 0.5
wait $CURL_PID 2>/dev/null || true
CLIENT_TEXT=$(node -e '
const fs=require("fs");const s=fs.readFileSync(process.argv[1],"utf8");let t="";
for (const line of s.split("\n")) if (line.startsWith("data: ")) { const e=JSON.parse(line.slice(6)); if (e.type==="text_delta") t+=e.text; }
process.stdout.write(t)' "$OUT/sigkill.sse")
SAVED_TEXT=$(node -e "const D=require('better-sqlite3');const d=new D('$DB',{readonly:true});const r=d.prepare(\"select content from messages where role='assistant'\").get();const c=JSON.parse(r.content);process.stdout.write(c.filter(b=>b.type==='text').map(b=>b.text).join(''))")
echo "client chars: ${#CLIENT_TEXT}, saved chars: ${#SAVED_TEXT}"
[ "${#SAVED_TEXT}" -gt 0 ] || fail "nothing persisted before SIGKILL"
case "$CLIENT_TEXT" in "$SAVED_TEXT"*) ;; *) fail "saved text is not a prefix of what the client displayed";; esac
# slow_tokens streams 3 chars per 400 ms: 2 s of loss is at most 15 chars plus one in-flight chunk.
DIFF=$(( ${#CLIENT_TEXT} - ${#SAVED_TEXT} ))
[ "$DIFF" -le 18 ] || fail "saved content is more than 2 s behind the client ($DIFF chars)"
echo "saved content within 2 s of the client (behind by $DIFF chars)"
boot backstop
GEN=$(query "select status, interrupted_reason reason from generations")
echo "after reboot: $GEN"
echo "$GEN" | grep -q '"status":"interrupted","reason":"crash"' || fail "backstop did not mark the row interrupted/crash"
USAGE=$(query "select estimated from usage_events")
echo "$USAGE" | grep -q '"estimated":1' || fail "backstop did not write an estimated usage row"
RESUME=$(curl -sS "$BASE/api/generations/$(query 'select id from generations' | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8"))[0].id)')/events?after=3")
echo "$RESUME" | grep -q '^data: .*"type":"snapshot"' || fail "resume did not return a snapshot"
echo "$RESUME" | grep '^data: .*"type":"snapshot"' | grep -q '"status":"interrupted"' || fail "snapshot status is not interrupted"
cleanup
echo "SIGKILL + backstop: ok"
echo "ALL OK"
