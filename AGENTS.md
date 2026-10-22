<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Working next to a running dev server

The developer runs `pnpm dev` in this checkout. Next 16 serves one dev server per checkout (`.next/dev/lock`) and hot-reloads every file write in it. Do not edit sources, run `next build`/`next typegen`, Playwright, the screenshot pass, or the shutdown script here while that lock names a live process: the server's clients are driven and re-chunked by those actions, and a tab can end up with "module factory is not available". `scripts/dev-lock-guard.mjs` refuses those scripts in that state. Work in a worktree instead:

```sh
pnpm worktree            # creates ../claude-app-wt with its own node_modules and data/
cd ../claude-app-wt && DATABASE_PATH=$PWD/data/wt.db pnpm exec next dev -p 3141
```

Land multi-file refactors as one write (`git apply`, `git checkout`), not file by file over seconds, so the watcher compiles one consistent state.

## Component layout

- A component simple enough for one file is `<feature>/<name>.tsx` (features: `chat`, `shell`, `admin`, `settings`, `auth`, `preview`, `evals`, `ui`).
- A complex component (private helpers, or more than one component's worth of code) is a folder, `<feature>/<name>/index.tsx`, holding the hooks, subcomponents and utils only it uses, with their tests beside them. Folders don't nest: a complex child gets its own sibling folder.
- A helper used by more than one component moves to the lowest level they share: the feature root (`components/chat/tab-reveal.ts`) within a feature, or `src/client/hooks/`, `src/client/store/` or `components/ui/` across features. Another feature may import a feature's root files (`shell/shell-user.tsx`, `shell/load-dialogs.tsx`) and a folder only through its `index.tsx`. The dev preview gallery is the exception and may import private pieces.
- Imports are relative within a feature and use `@client/...` beyond it.
