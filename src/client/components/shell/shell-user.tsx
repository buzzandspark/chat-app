"use client";
import { createContext, useContext, type ReactNode } from "react";

export interface ShellUser {
  userId: string;
  /** Whether the scenario panel is shown; every signed-in user may run scenarios (they are scripted and replayed, so they spend nothing). */
  scenarioPanel: boolean;
}

const ShellUserContext = createContext<ShellUser | null>(null);

/** Rendered by the layout once the session is known; everything that needs the user sits inside (#20). */
export function ShellUserProvider({ userId, scenarioPanel, children }: ShellUser & { children: ReactNode }) {
  return <ShellUserContext.Provider value={{ userId, scenarioPanel }}>{children}</ShellUserContext.Provider>;
}

export function useShellUser(): ShellUser {
  const value = useContext(ShellUserContext);
  if (!value) throw new Error("useShellUser outside ChatShell");
  return value;
}
