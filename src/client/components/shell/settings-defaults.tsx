"use client";
import { useEffect } from "react";
import { readLastChoice } from "@client/hooks/use-last-choice";
import { useChatStore } from "@client/store/context";
import { useShellUser } from "./shell-user";

/** #22: a new chat starts on the model and effort this user chose last (stored per user, read after mount). */
export function SettingsDefaults() {
  const store = useChatStore();
  const { userId } = useShellUser();
  useEffect(() => {
    store.setDefaultSettings(readLastChoice(userId));
  }, [store, userId]);
  return null;
}
