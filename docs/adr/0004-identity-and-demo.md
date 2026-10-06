# ADR-0004: Identity and the public demo path

Status: accepted · Date: 2026-10-06

## Context

The app has to be openable by anyone evaluating it, without a login wall and without spending API money on strangers, while invited accounts get live models under a cost cap.

## Decision

- **Auth**: `better-auth` with the Drizzle adapter (`provider: "sqlite"`), email + password, `disableSignUp: true`, the `admin` plugin. The first admin is seeded from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. A cookie-presence redirect lives in `proxy.ts`; real validation is `auth.api.getSession` in server components and route handlers, once per SSE connection.
- **Demo path**: "Try the demo" creates an ephemeral user with role `demo` and a 24 h session. The provider is forced to replay or scripted on the server, so the demo cannot spend API money regardless of what the client asks for. Each visitor gets their own demo user; an in-process hourly timer purges demo users older than 24 h.
- **Invited accounts**: created by the admin without a password; an invite link (random 32-byte token, SHA-256 stored, 7-day expiry, single use) lets the user set a password and signs them in. Password reset reuses the flow. Invited accounts get live models under a per-user all-time cost cap.

## Alternatives rejected

- **OAuth sign-in.** Adds provider setup and redirect URLs per PR environment for no benefit when the admin controls who gets in.
- **Anonymous demo without a user row.** Chats, drafts, and rate limits all key on a user id; a real row with a short life is simpler than a parallel anonymous path.
- **A shared demo account.** Visitors would see each other's chats.
