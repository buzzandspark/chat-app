# ADR-0004: Identity and guests

Status: accepted · Date: 2026-10-06, revised 2026-10-12

## Context

Anyone should be able to try the app without a login wall, but strangers must not be able to spend much API money. Invited accounts get every model under a cost cap.

## Decision

- **Auth**: `better-auth` with the Drizzle adapter, email + password, `disableSignUp: true`, the `admin` and `anonymous` plugins. The first admin is seeded at boot from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. `proxy.ts` only checks that a session cookie exists; real validation is `auth.api.getSession` in server components and route handlers, once per SSE connection.
- **Invited accounts**: created by the admin without a password; an invite link (random 32-byte token, stored as SHA-256, 7-day expiry, single use, claimed atomically) sets the password and signs the user in. Password reset reuses the flow. Each account has an all-time cost cap (`DEFAULT_COST_CAP_USD` when left blank).
- **Guests**: a cookieless page request is sent to `/api/guest`, which creates an anonymous user with role `guest` and a `GUEST_COST_CAP_USD` cap, then returns to the page. New guests are limited per address (an IPv6 /64 counts as one) and globally per day; past that it is sign-in only. `/api/auth/sign-in/anonymous` is closed over HTTP. Guests run Haiku only (the chat route returns 403 `guest_model` otherwise). Signing in or redeeming an invite moves the guest's chats, generations and usage to the account. Guests idle for 30 days are purged hourly and never appear in the admin console.
- **Harness**: only with `E2E=1` do cookieless requests run as `DEV_USER_ID`; development otherwise behaves like production.

## Alternatives rejected

- **OAuth sign-in.** Provider setup and redirect URLs per environment, for no benefit when the admin controls who gets in.
- **A shared demo account.** Visitors would see each other's chats.
- **Guests without a user row.** Chats, drafts and spend all key on a user id; a real row with a short life is simpler than a parallel path.
