"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useChatStore } from "@client/store/context";

export interface ShellUser {
  userId: string;
  /** An anonymous visitor: Haiku only (the other models show greyed out) until it signs in. */
  guest: boolean;
  /** Whether the scenario panel is shown; every signed-in user may run scenarios (they are scripted and replayed, so they spend nothing). */
  scenarioPanel: boolean;
  /** The Settings switch; the server holds it too and skips detection when it is off. */
  exploreOptions: boolean;
  setExploreOptions: (on: boolean) => void;
}

const ShellUserContext = createContext<ShellUser | null>(null);

/** Rendered by the layout once the session is known; everything that needs the user sits inside. */
export function ShellUserProvider({ userId, guest, scenarioPanel, exploreOptions: initialExplore, children }: Omit<ShellUser, "setExploreOptions"> & { children: ReactNode }) {
  const [exploreOptions, setExploreOptions] = useState(initialExplore);
  // The store's reply-end watcher reads the switch outside React (ADR-0005: the store follows render).
  const store = useChatStore();
  store.setExploreOptions(exploreOptions);
  return <ShellUserContext.Provider value={{ userId, guest, scenarioPanel, exploreOptions, setExploreOptions }}>{children}</ShellUserContext.Provider>;
}

export function useShellUser(): ShellUser {
  const value = useContext(ShellUserContext);
  if (!value) throw new Error("useShellUser outside ChatShell");
  return value;
}
