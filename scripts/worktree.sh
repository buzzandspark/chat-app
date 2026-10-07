#!/usr/bin/env sh
# Creates (or refreshes) a sibling git worktree for agents, CI-like runs and
# experiments, so the developer's checkout and its dev server are never
# touched. Usage: sh scripts/worktree.sh [name] [commit]   (defaults: wt, HEAD)
# The worktree gets its own node_modules (from the pnpm store, offline when
# possible), its own data/ directory and its own dev port (3141).
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
