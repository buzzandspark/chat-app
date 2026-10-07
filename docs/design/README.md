# Design iterations

Every iteration is captured by `pnpm screenshots <label>`: the phone frame (Pixel 7) first, light then dark, then the desktop frame. Review happens on the phone frames; the desktop is the expansion (D0).

## step2 → step4

| What changed | Before | After |
| --- | --- | --- |
| Streaming caret rendered on its own line below the paragraph; now drawn inline by CSS after the last block | `step2/phone-light-04-streaming-thinking.png` | `step4/phone-light-04-streaming-thinking.png` |
| A second Stop button sat under the streaming message while the composer already had one; the composer owns stop now | `step2/phone-light-04-streaming-thinking.png` | `step4/phone-light-04-streaming-thinking.png` |
| Header had only the menu button; it now carries the chat title | `step2/phone-light-05-done-fallback.png` | `step4/phone-light-05-done-fallback.png` |
| Messages gained a visible "⋯" actions button (no hover-only affordances on touch) and a latency popover | `step2/phone-light-05-done-fallback.png` | `step4/phone-light-05-done-fallback.png` |
| Sidebar gained search and per-chat rename/delete behind "⋯" | `step2/phone-light-09-sidebar.png` | `step4/phone-light-09-sidebar.png` |

## Found by screenshots and tests, not by eye

- The composer could be pushed below the fold by a long thread (missing `min-h-0` on the content column); the 200-message perf scenario caught it.
- The composer did not re-render when a reply finished, so the stop button lingered and ↑-to-edit never fired; a desktop keyboard spec caught it.
- Text typed before hydration was discarded; WebKit specs caught it, and the composer now adopts it.
