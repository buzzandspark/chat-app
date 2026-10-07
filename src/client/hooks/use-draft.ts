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

/** D18: drafts per (user, chat) in localStorage, debounced 300 ms, flushed on pagehide. */
export function useDraft(key: string, value: string): void {
  const latest = useRef(value);
  useEffect(() => {
    latest.current = value;
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
  }, [key, value]);
  useEffect(() => {
    const flush = () => {
      try {
        if (latest.current.trim()) localStorage.setItem(key, latest.current);
        else localStorage.removeItem(key);
      } catch {
        // storage unavailable
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [key]);
}
