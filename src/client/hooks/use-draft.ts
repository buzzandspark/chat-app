"use client";
import { useSyncExternalStore } from "react";

const PREFIX = "chat:draft:";

export function draftKey(userId: string, chatId: string): string {
  return `${PREFIX}${userId}:${chatId}`;
}

// D18: drafts per (user, chat) live here, outside React, and are saved to localStorage 300 ms after the
// last change and at once when the page hides. Read lazily, so nothing is written until the user types.
const drafts = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Set<() => void>();
let saveOnHide = false;

function save(key: string): void {
  timers.delete(key);
  try {
    const value = drafts.get(key) ?? "";
    if (value.trim()) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}

function saveAll(): void {
  for (const [key, timer] of [...timers]) {
    clearTimeout(timer);
    save(key);
  }
}

function getDraft(key: string): string {
  let value = drafts.get(key);
  if (value === undefined) {
    try {
      value = localStorage.getItem(key) ?? "";
    } catch {
      value = "";
    }
    drafts.set(key, value);
  }
  return value;
}

export function setDraft(key: string, value: string): void {
  if (getDraft(key) === value) return;
  drafts.set(key, value);
  for (const listener of listeners) listener();
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(() => save(key), 300));
  if (saveOnHide) return;
  saveOnHide = true;
  window.addEventListener("pagehide", saveAll);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveAll();
  });
}

/** A sent message's draft is gone at once, from memory and storage. */
export function clearDraft(key: string): void {
  setDraft(key, "");
  clearTimeout(timers.get(key));
  save(key);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The chat's draft; empty on the server and in hydration, which render the field empty. */
export function useDraft(key: string): string {
  return useSyncExternalStore(
    subscribe,
    () => getDraft(key),
    () => "",
  );
}
