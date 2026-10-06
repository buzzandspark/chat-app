#!/usr/bin/env sh
# D3 verification against the built standalone server (the Docker image runs
# the same server.js):
#  1. SIGTERM mid-stream: the partial is in SQLite, a usage_events row flagged
#     estimated exists, the generation is `interrupted { reason: "shutdown" }`,
#     the connected client received the interrupted event, and the process
#     exited within the grace period.
#  2. SIGKILL mid-stream: the saved content is within 2 s of what the client
#     displayed; on the next boot the backstop marks the row interrupted
#     (reason crash) and writes an estimated usage row.
set -eu
cd "$(dirname "$0")/.."
PORT=${PORT:-3126}
BASE="http://127.0.0.1:$PORT"
DB="$PWD/data/shutdown-test.db"
OUT=${OUT:-"$PWD/data/shutdown-test"}
mkdir -p "$OUT"
rm -f "$DB" "$DB-wal" "$DB-shm"

uuid() { node -e 'console.log(crypto.randomUUID())'; }
boot() {
  PORT=$PORT HOSTNAME=127.0.0.1 REPLAY_MODE=1 SCENARIO_PANEL=1 E2E=1 DATABASE_PATH="$DB" sh scripts/standalone.sh > "$OUT/server-$1.log" 2>&1 &
  for i in $(seq 1 60); do curl -fsS "$BASE/api/health" >/dev/null 2>&1 && return 0; sleep 0.5; done
  echo "server did not start"; cat "$OUT/server-$1.log"; exit 1
}
pid() { lsof -ti :"$PORT" | head -1; }
start_stream() {
  G=$(uuid); C=$(uuid); U=$(uuid); A=$(uuid)
  curl -sS -N -m 60 -X POST "$BASE/api/chat" -H 'content-type: application/json' \
    -d "{\"chatId\":\"$C\",\"generationId\":\"$G\",\"messageId\":\"$U\",\"assistantMessageId\":\"$A\",\"text\":\"$1\",\"model\":\"claude-sonnet-5-5\",\"scenario\":\"$2\"}" > "$OUT/$3.sse" 2>/dev/null &
  CURL_PID=$!
}
query() { node -e "const D=require('better-sqlite3');const d=new D('$DB',{readonly:true});console.log(JSON.stringify(d.prepare(process.argv[1]).all()))" "$1"; }
fail() { echo "FAIL: $1"; exit 1; }

echo "== 1. SIGTERM mid-stream =="
boot sigterm
start_stream "sigterm test" slow_tokens sigterm
sleep 4
SERVER=$(pid); T0=$(date +%s)
kill -TERM "$SERVER"
for i in $(seq 1 60); do kill -0 "$SERVER" 2>/dev/null || break; sleep 0.5; done
kill -0 "$SERVER" 2>/dev/null && fail "process still alive after 30s"
T1=$(date +%s); echo "exited in $((T1 - T0))s"
wait $CURL_PID 2>/dev/null || true
grep -q '^event: interrupted' "$OUT/sigterm.sse" || fail "client did not receive interrupted event"
grep -A2 '^event: interrupted' "$OUT/sigterm.sse" | grep -q '"reason":"shutdown"' || fail "interrupted reason is not shutdown"
GEN=$(query "select status, interrupted_reason reason from generations")
echo "generation: $GEN"
echo "$GEN" | grep -q '"status":"interrupted","reason":"shutdown"' || fail "generation row not interrupted/shutdown"
MSG=$(query "select status, length(content) len from messages where role='assistant'")
echo "message: $MSG"
echo "$MSG" | grep -q '"status":"interrupted"' || fail "message row not interrupted"
echo "$MSG" | grep -q '"len":2' && fail "partial content was not persisted"
USAGE=$(query "select estimated, output_tokens from usage_events")
echo "usage: $USAGE"
echo "$USAGE" | grep -q '"estimated":1' || fail "no estimated usage row"
echo "SIGTERM: ok"

echo "== 2. SIGKILL mid-stream, then boot backstop =="
rm -f "$DB" "$DB-wal" "$DB-shm"
boot sigkill
start_stream "sigkill test" slow_tokens sigkill
sleep 6
SERVER=$(pid)
kill -KILL "$SERVER"
sleep 0.5
wait $CURL_PID 2>/dev/null || true
# What the client displayed: every text_delta received, joined.
CLIENT_TEXT=$(node -e '
const fs=require("fs");const s=fs.readFileSync(process.argv[1],"utf8");let t="";
for (const line of s.split("\n")) if (line.startsWith("data: ")) { const e=JSON.parse(line.slice(6)); if (e.type==="text_delta") t+=e.text; }
process.stdout.write(t)' "$OUT/sigkill.sse")
SAVED_TEXT=$(node -e "const D=require('better-sqlite3');const d=new D('$DB',{readonly:true});const r=d.prepare(\"select content from messages where role='assistant'\").get();const c=JSON.parse(r.content);process.stdout.write(c.filter(b=>b.type==='text').map(b=>b.text).join(''))")
echo "client chars: ${#CLIENT_TEXT}, saved chars: ${#SAVED_TEXT}"
[ "${#SAVED_TEXT}" -gt 0 ] || fail "nothing persisted before SIGKILL"
case "$CLIENT_TEXT" in "$SAVED_TEXT"*) ;; *) fail "saved text is not a prefix of what the client displayed";; esac
# slow_tokens streams 3 chars per 400 ms, so 2 s of loss is at most 15 chars (plus one in-flight chunk).
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
echo "$RESUME" | grep -q '^event: snapshot' || fail "resume did not return a snapshot"
echo "$RESUME" | grep -q '"status":"interrupted"' || fail "snapshot status is not interrupted"
kill -TERM "$(pid)"; sleep 1
echo "SIGKILL + backstop: ok"
echo "ALL OK"
