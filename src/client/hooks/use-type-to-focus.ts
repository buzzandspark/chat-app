"use client";
import { useEffect } from "react";

const EDITABLE = "input, textarea, select, [contenteditable=''], [contenteditable=true], [role=menu], [role=dialog]";

/** The visible composer: Activity keeps other chats' views mounted but hidden. */
export function visibleComposer(): HTMLTextAreaElement | null {
  for (const el of document.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Message"]')) {
    if (el.closest("[inert]")) continue;
    if (typeof el.checkVisibility === "function" ? el.checkVisibility() : true) return el;
  }
  return null;
}

/** Typing a character with nothing editable focused goes to the composer: focusing on keydown lets the character land there. */
export function shouldFocusComposer(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key.length !== 1 || e.key === " ") return false;
  const target = e.target as HTMLElement | null;
  if (target?.closest?.(EDITABLE)) return false;
  const active = document.activeElement as HTMLElement | null;
  return !active?.closest?.(EDITABLE);
}

export function useTypeToFocus(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (!shouldFocusComposer(e)) return;
      const composer = visibleComposer();
      if (!composer || composer.disabled) return;
      composer.focus();
      // The caret at the end, so the character joins a draft instead of leading it.
      const end = composer.value.length;
      composer.setSelectionRange(end, end);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
