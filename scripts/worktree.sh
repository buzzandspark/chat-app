#!/usr/bin/env sh
# Sibling git worktree for agents and harness runs, so the developer's checkout and dev server stay untouched.
# Usage: sh scripts/worktree.sh [name] [commit] (defaults: wt, HEAD); own node_modules, data/ and port 3141.
set -eu
cd "$(dirname "$0")/.."
NAME=${1:-wt}
REF=${2:-HEAD}
TARGET="$(dirname "$PWD")/$(basename "$PWD")-$NAME"
if [ -d "$TARGET" ]; then
  echo "worktree exists at $TARGET"
else
  git worktree add "$TARGET" "$REF"
fi
cd "$TARGET"
pnpm install --offline >/dev/null 2>&1 || pnpm install
mkdir -p data
cat <<MSG

Worktree ready at $TARGET
  dev server:  cd $TARGET && DATABASE_PATH=\$PWD/data/wt.db pnpm exec next dev -p 3141
  checks:      cd $TARGET && pnpm typecheck && pnpm lint && pnpm test && REPLAY_MODE=1 pnpm build
  remove:      git -C $(pwd -P | sed "s|-$NAME\$||") worktree remove $TARGET
MSG
