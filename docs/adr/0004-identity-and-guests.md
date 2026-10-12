# ADR-0004: Identity and guests

Status: accepted · Date: 2026-10-06, revised 2026-10-12

## Context

Anyone should be able to try the app without a login wall, but strangers must not be able to spend much API money. Invited accounts get every model under a cost cap.

## Decision

- **Auth**: `better-auth` with the Drizzle adapter, email + password, `disableSignUp: true`, the `admin` and `anonymous` plugins. The first admin is seeded at boot from `ADMIN_EMAIL` (stored lowercased) / `ADMIN_PASSWORD`. `proxy.ts` only checks that a session cookie exists; real validation is `auth.api.getSession` in server components and route handlers, once per SSE connection.
- **HTTP surface**: `/api/auth/*` answers only `POST sign-in/email` and `POST sign-out`; every other path and every GET is a 404, so guests can't delete or rename themselves over HTTP. The server reads sessions and signs guests in through `auth.api`.
- **Invited accounts**: created by the admin without a password; an invite link (random 32-byte token, stored as SHA-256, 7-day expiry, single use, claimed atomically) sets the password and signs the user in. Password reset reuses the flow. Each account has an all-time cost cap (`DEFAULT_COST_CAP_USD` when left blank).
- **Guests**: a cookieless page request is sent to `/api/guest`, which creates an anonymous user with role `guest` and a `GUEST_COST_CAP_USD` cap, then returns to the page. Only a top-level page visit (Fetch Metadata `navigate` and `document`) or the login page's same-site POST creates one. A prefetch or prerender (`Sec-Purpose`) gets a 503, which the browser discards, so the visit itself makes the guest; images, fetches, link unfurlers and monitors are sent to the login page. Neither writes anything. New guests are limited per address and overall, generously, since the limit guards rows, not spend; past that it is sign-in only. Guests run Haiku only, whatever model a request names. Signing in or redeeming an invite moves the guest's chats, generations and usage to the account. Guests idle for 30 days are purged hourly and never appear in the admin console.
- **Guest spend**: besides its own cap, a guest is charged to shared daily budgets: the address that created it (an IPv6 /64 counts as one), its IPv6 /48, and all guests together. Each is a leaky bucket in `spend_buckets` that drains at its daily rate; a guest's keys are stored on `users.budget_keys` at creation. A spent budget refuses the guest's new replies, forks and option rewrites with 429 and the wait, and Explore skips detection. The caps are soft: running replies finish and are charged. What can run at once bounds the overshoot: 2 replies and 2 Explore calls per guest, 20 of each across guests, `max_tokens` 8192, and a prompt cap, estimated from UTF-8 bytes, that keeps natural text below Haiku's long-context tier. Guests also have per-minute limits per guest and per address on sends (replies, forks, declared winners) and on Explore rewrites. Invited accounts have none of these limits.
- **Client address**: the single address in `TRUSTED_IP_HEADER` (set by the platform's proxy, `x-real-ip` on Railway), else the `X-Forwarded-For` entry `TRUST_PROXY_HOPS` from the right. When the header is set, better-auth's sessions and sign-in limiter read it too. A missing or unreadable address shares one `unknown` key, so it fails closed.
- **Scenarios**: scripted replies and the long-chat seed write rows without spending, which would let a stranger fill the disk for free, so production runs them only for admins and the e2e harness.
- **Harness**: only with `E2E=1` do cookieless requests run as `DEV_USER_ID`; development otherwise behaves like production.

## Alternatives rejected

- **OAuth sign-in.** Provider setup and redirect URLs per environment, for no benefit when the admin controls who gets in.
- **A shared demo account.** Visitors would see each other's chats.
- **Guests without a user row.** Chats, drafts and spend all key on a user id; a real row with a short life is simpler than a parallel path.
- **Reserving a guest reply's worst-case cost up front.** It refuses replies that would have fit; bounding what runs at once keeps the overshoot to a few cents.
- **Stopping running replies when a shared budget fills.** It would cut off other people on a shared address mid-reply.
- **A CAPTCHA before the first guest reply.** A wall for every visitor, where budgets bound what abuse can cost.
