# Product brief

**Cadence** is a chat client that keeps its rhythm on a bad connection.

## Who it is for

Someone evaluating a consumer chat product on a phone: they will open it on the train, background it to answer a message, and expect the reply to be there, complete, when they come back.

## What it must do well

1. **Stream smoothly** at the rate tokens arrive, on a mid-range Android, without the page jumping.
2. **Survive disconnects**: a dropped radio, a backgrounded tab, a server deploy, with no duplicated or missing text.
3. **Load fast** on a throttled connection: server-rendered shell, no font flash, a tight JS budget.
4. **Feel native on a phone**: the keyboard never covers the composer, tap targets are 44 px, the sidebar is a tap away.
5. **Be honest about state**: cut off, interrupted, rate limited, refused, over quota each have their own wording and action.

## What it deliberately does not do

- Branching conversations.
- Attachments (stretch).
- Multi-instance scaling (described, not built).

## Measures

Time to first token, airplane-mode reconnect, scroll stability on long code, keyboard behaviour on iOS and Android. See `docs/comparison.md`.
