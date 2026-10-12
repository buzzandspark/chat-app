"use client";
import { useEffect } from "react";
import { readLastChoice } from "@client/hooks/use-last-choice";
import { useChatStore } from "@client/store/context";
import { GUEST_MODEL } from "@shared/models";
import { useShellUser } from "./shell-user";

/** #22: a new chat starts on the model and effort this user chose last (stored per user, read after mount). */
export function SettingsDefaults() {
  const store = useChatStore();
  const { userId, guest } = useShellUser();
  useEffect(() => {
    // A guest has Haiku only, whatever this browser chose before under an account.
    store.setDefaultSettings(guest ? { ...readLastChoice(userId), model: GUEST_MODEL } : readLastChoice(userId));
  }, [store, userId, guest]);
  return null;
}
