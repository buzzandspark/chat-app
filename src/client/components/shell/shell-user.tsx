"use client";
import { createContext, useContext, useState, type ReactNode } from "react";

export interface ShellUser {
  userId: string;
  /** Whether the scenario panel is shown; every signed-in user may run scenarios (they are scripted and replayed, so they spend nothing). */
  scenarioPanel: boolean;
  /** The Settings switch; the server holds it too and skips detection when it is off. */
  exploreOptions: boolean;
  setExploreOptions: (on: boolean) => void;
}

const ShellUserContext = createContext<ShellUser | null>(null);

/** Rendered by the layout once the session is known; everything that needs the user sits inside (#20). */
export function ShellUserProvider({ userId, scenarioPanel, exploreOptions: initialExplore, children }: Omit<ShellUser, "setExploreOptions"> & { children: ReactNode }) {
  const [exploreOptions, setExploreOptions] = useState(initialExplore);
  return <ShellUserContext.Provider value={{ userId, scenarioPanel, exploreOptions, setExploreOptions }}>{children}</ShellUserContext.Provider>;
}

export function useShellUser(): ShellUser {
  const value = useContext(ShellUserContext);
  if (!value) throw new Error("useShellUser outside ChatShell");
  return value;
}
