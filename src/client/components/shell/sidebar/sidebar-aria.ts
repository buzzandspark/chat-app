/**
 * The sidebar's modality depends on the mode, not either open flag: the phone overlay closed leaves the tab order and
 * a11y tree, open it is the modal (focusable so focus can move onto it); the dock collapsed is inert, open a landmark.
 * `desktop` is null on the server and in hydration: nothing is set then, so a docked list is never inert before hydration.
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
