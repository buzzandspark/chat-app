# ADR-0005: The chat route renders from the client store; the server seeds it

Status: accepted · Date: 2026-10-07

## Context

Switching chats took a full server round trip (about 650 ms in development and over a network, 46 to 59 ms only on a localhost production build) even for chats already in memory, with no feedback until the new thread arrived. Partial prerendering bought little because the thread was server data inside a Suspense boundary, and `/c/new` was a mounted page: Next keeps up to three routes alive in a hidden `<Activity>`, and a second "New chat" brought the old `/c/new` view back with a different server-generated id, which re-hydrated an empty list on every render and wiped the thread it was streaming into.

## Decision

- **A chat id is chosen by the client.** "New chat" navigates straight to `/c/<uuidv7>`; the engine creates the `chats` row on the first send. An id the server has never seen renders an empty, usable view, not a 404. `/c/new` survives only as a 307 alias in `proxy.ts` for bookmarks and external links, so no "new" view is ever mounted.
- **The client `ChatStore` is the source of truth for the view.** `ChatView` is a Client Component in the route's static shell: it reads the id from `useParams()`, which resolves synchronously during a client navigation, and renders the thread from the store at once. Per-chat settings (model, "Think harder", scenario) live in the store too, so neither a remount nor an Activity eviction resets them; drafts stay in `localStorage` per (user, chat).
- **Server rows are a seed, delivered through a Suspense child.** The page renders `<ChatView>` with a `<Suspense>` child that awaits `params`, reads SQLite and renders `SeedChat`, a Client Component that reconciles the rows into the store during its render and renders nothing. On a hard load the rows arrive in the same HTML stream; on a client navigation the view is already on screen when they arrive. Reconciliation keeps local in-flight messages, never replaces a finished local reply with a stale `streaming` row, and keeps optimistic messages the server has not listed yet (a POST still in flight, or one it refused with 429, 503 or 402).
- **While a chat is unseeded the thread area shows a skeleton with the list's own spacing**; the composer is the real one, so nothing collapses. `GET /api/chats/:id` returns the same rows as the page, so the sidebar can seed a chat on hover, focus or `touchstart` and for the top five when it opens; a revisit needs no request.

## Alternatives rejected

- **Keying the `/c/new` view by a fresh id.** It hides the symptom; the mounted "new" page would still be retained and restored by the router, and the first send would still remount the view under its real URL (a 600 ms skeleton, a closed phone keyboard, a reset picker).
- **A `redirect()` from the page for `/c/new`.** It runs inside the dynamic hole after the static shell has streamed, so it costs a second document load; the proxy answers before any rendering.
- **A fully client-rendered route that fetches JSON on mount.** A cold hard load would then need two round trips (HTML, then rows) before the thread paints; the Suspense seed keeps one streamed response for that case.
- **Passing the rows as a promise prop into the view.** The view's element would then be created inside the dynamic server component, which puts it outside the static shell and back on the server round trip for every navigation.

## Consequences

The server seed still streams on every navigation (the router fetches the route's dynamic hole), but the view never waits for it: for a loaded or prefetched chat it is a no-op reconcile. The page-level Suspense fallback is only ever seen on a hard load before the view's own chunk streams, and it mirrors the real layout class for class.

## Amendment (2026-10-12): a new chat at /c

A new chat now lives at `/c` until its first send. `/c` is a page that renders the same view with a client-chosen id: in-app New chat pushes `/c?n=<id>` (so each New chat gets a view of its own, since the router keys views by address) and the view drops `n` from the address on mount; a cold load of `/c` picks a fresh id. The first send rewrites the address to `/c/<id>` with `history.replaceState`, so nothing remounts (the phone keyboard stays up). A new chat's draft is kept under the key `new` until that send. `/c/new` and `/` redirect to `/c`.
