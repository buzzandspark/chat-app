"use client";
import { useEffect, useRef } from "react";

const PREFIX = "cadence:draft:";

export function draftKey(userId: string, chatId: string): string {
  return `${PREFIX}${userId}:${chatId}`;
}

export function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}

/**
 * D18: drafts per (user, chat) in localStorage, debounced 300 ms, flushed when the page hides.
 * `enabled` is false until the composer has adopted the stored draft: a background tab never runs
 * the adoption frame, and writing the initial empty value would erase the draft.
 */
export function useDraft(key: string, value: string, enabled = true): void {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
    if (!enabled) return;
    const write = () => {
      try {
        if (value.trim()) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch {
        // storage unavailable
      }
    };
    const timer = setTimeout(write, 300);
    return () => clearTimeout(timer);
  }, [key, value, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      try {
        if (latest.current.trim()) localStorage.setItem(key, latest.current);
        else localStorage.removeItem(key);
      } catch {
        // storage unavailable
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [key, enabled]);
}
