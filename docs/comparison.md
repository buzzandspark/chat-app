# Comparison with the Claude desktop app

Narrow, hand-measured scenarios. The Chat column comes from `pnpm e2e --project=pixel7 e2e/perf.spec.ts` (Pixel 7 emulation, CPU 4x, Fast 3G, local server so TTFB is not representative) and from the scripted scenarios; the Claude desktop column has to be measured by hand on the same phone and network, with a stopwatch or a screen recording, and is left blank until that is done.

## Method

- **Time to first token.** Same prompt, same model. Chat: the latency popover's "Client: sent → first paint" on a live model; in replay the scripted time-to-first-token is 450 ms. Desktop app: screen recording, frame count from send to the first glyph.
- **Airplane mode for 30 s mid-stream.** Start a long reply, toggle airplane mode for 30 s, toggle back. Chat: `dropped_connection` scenario is the automated proxy; by hand, note whether text resumed with no duplicate or missing sentence and how long after reconnect. Desktop app: same by hand.
- **Scroll stability on long code.** Run `giant_code_block`; scroll up 48 px during streaming and check the view does not jump; frame times from `docs/perf/`.
- **Mobile keyboard.** Open the keyboard on iOS Safari and Android Chrome; the composer must stay visible with no jump, and bottom sheets with a text field must sit above the keyboard. Record with the platform screen recorder into `docs/recordings/`.

## Results

| Scenario | Claude desktop | Chat | Notes |
| --- | --- | --- | --- |
| Time to first token (same prompt, same model) | _by hand_ | 2.0 s to first painted token on throttled Pixel 7 in replay (includes the scripted 450 ms TTFT and the panel sheet closing) | live-model number needs a key |
| Airplane mode for 30 s mid-stream, then back online | _by hand_ | resumes from the last sequence with no duplicated or missing text (e2e `dropped_connection`, `reloading mid-stream`) | |
| Scroll stability while a 600-line code block streams | _by hand_ | p99 frame 33 ms, 0 long frames over 1,400 frames; no jump on scroll-up | |
| Keyboard open on iOS Safari: composer visible, no jump | _by hand_ | `interactive-widget=resizes-content` plus the `visualViewport` inset on the composer and sheets | needs a real device recording |
| Keyboard open on Android Chrome: composer visible, no jump | _by hand_ | same | needs a real device recording |
