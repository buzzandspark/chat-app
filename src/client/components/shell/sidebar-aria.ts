/**
 * The sidebar's modality, which depends on the mode it is in rather than on either open flag alone:
 * the phone overlay closed is off-screen, so it leaves the tab order and the accessibility tree; open,
 * it is the modal (the shell makes the column behind it inert), focusable itself so opening can move focus
 * onto it and a screen reader announces "Chats, dialog". The desktop dock collapsed is inert too, and open
 * is a plain landmark.
 *
 * `desktop` is null on the server and in the hydration render, where the viewport is unknown: nothing
 * is set then, so the server HTML matches the hydration render and a desktop's docked list is never
 * inert before hydration. React re-renders with the real viewport straight after hydrating.
 */
export function sidebarAria(
  desktop: boolean | null,
  phoneOpen: boolean,
  desktopOpen: boolean,
): { inert?: true; role?: "dialog"; "aria-modal"?: true; tabIndex?: -1 } {
  if (desktop === null) return {};
  if (desktop) return desktopOpen ? {} : { inert: true };
  return phoneOpen ? { role: "dialog", "aria-modal": true, tabIndex: -1 } : { inert: true };
}
