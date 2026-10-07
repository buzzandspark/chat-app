"use client";
import { createContext, useContext } from "react";

export interface ShellUser {
  userId: string;
  /** Whether the scenario panel is available to this user (env flag or demo role). */
  scenarioPanel: boolean;
}

const ShellUserContext = createContext<ShellUser | null>(null);
export const ShellUserProvider = ShellUserContext.Provider;

export function useShellUser(): ShellUser {
  const value = useContext(ShellUserContext);
  if (!value) throw new Error("useShellUser outside ChatShell");
  return value;
}
