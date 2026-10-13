# ADR-0006: Explore options forks a chat by copying it; the options are a side effect of the reply

Status: accepted · Date: 2026-10-09

## Context

A reply that lays out alternatives invites the user to dig into each one, but a single thread can only follow one. The feature has to be cheap: the parent's history is the bulk of every follow-up request, and the Claude API caches a prompt prefix for five minutes, scoped to one model and readable only after the request that wrote it has begun its response. It also must not make the chat itself slower or less reliable.

## Decision

- **Detection is a side effect.** When a reply settles as `done`, the engine's `afterDone` hook hands the reply's text to `OptionsService`, which asks Claude Haiku 5.5 through its own client (`messages.stream`, a zod output format, adaptive thinking at medium effort) for `{ title, prompt }[]` and stores it on the message. The hook runs after the reply's rows, spend and terminal event are written and is wrapped so it can never affect the reply. Haiku sees only the final reply, never the chat, so its spend is cents and no history is duplicated; its usage row sits under the parent generation and counts against the cap. The client fetches the result once when a reply ends on screen; a saved chat gets it with its rows. Scenario runs and replay mode get scripted options; forks and users at their cap get no detection.
- **A fork copies every parent row.** Each fork is a new chat with fresh row ids, the same positions and content, a `forked_from` link (set to null if the parent is deleted) and `fork_position` where its own turns begin. History loading, search, resume and delete need no new paths; the copies add rows but no new mechanism.
- **Every fork request repeats the parent's last request.** The engine stores the effort a reply was asked with (`messages.thinking`); a fork takes model and effort from the parent's last assistant row, never from the client, so the system prompt, betas, fallbacks and `output_config` all match. The first fork's request adds a cache breakpoint on the parent's final reply; fork 1 starts alone, the rest wait for its `message_start` (10 s at most) and then read the entry it wrote. A test builds both requests and asserts equality in everything but the appended turns.
- **A fork's first reply retries itself.** A request that fails before the API has begun a message is sent again, three times, after 1 s, 2 s and 4 s (longer when the API asks). After `message_start` the ordinary stopped and interrupted paths apply.
- **No forks of forks, at most ten forks per parent.** Fork trees would need their own tab, divider and cache rules; the button never shows in a fork and the route refuses one.
- **No running limit or send window for an invited user's forks.** The fork route bounds a fan-out at ten, and each fork holds its worst case against the cost cap like any reply; a guest's fork takes half a reply's place and waits for one.

## Alternatives rejected

- **Referencing parent rows instead of copying.** It saves disk but puts a branch walk into history loading, search, eviction and delete, and an edit of the parent would change the forks' past.
- **Sending the options in the reply's stream.** A trailing event would delay `done` or need a second terminal, and a saved chat would still need the column.
- **Running Haiku over the whole chat.** Caches are model-scoped, so every call would be uncached Haiku input, and a long chat would cross into long-context pricing.
- **Starting all forks at once.** N parallel requests over the same prefix all write their own cache entry and read none of each other's.

## Consequences

A fork costs one cache read of the parent plus the new turn; forks after the first also read the parent's final reply from the entry fork 1 wrote. Past 4.5 minutes from the parent reply's request start the entry has expired and the first fork pays for the whole prefix again, which the button's tooltip says. Copied rows appear in search results once per fork. Forking spends the reply's options when the first fork starts, so a reply can be explored once: the route refuses a reply whose options are spent or that is not the chat's last finished row, and answers a request repeating fork ids with the forks it already started, which is how the client retries an Explore whose answer never arrived. Declaring a winner deletes the main chat and the other forks and clears the winner's fork link, so its copied rows become its own history and it can be forked again.
