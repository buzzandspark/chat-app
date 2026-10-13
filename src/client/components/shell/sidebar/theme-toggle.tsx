"use client";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { IconButton } from "../../ui/icon-button";

const listeners = new Set<() => void>();
function readDark(): boolean {
  return document.documentElement.classList.contains("dark");
}
function setDark(dark: boolean): void {
  // Every colour flips in the same frame; otherwise controls with a colour transition lag ~150 ms behind the page.
  const freeze = document.createElement("style");
  freeze.textContent = "*,*::before,*::after{transition:none!important}";
  document.head.appendChild(freeze);
  document.documentElement.classList.toggle("dark", dark);
  // The new colours are computed while transitions are off, then the styles come back.
  void getComputedStyle(document.body).backgroundColor;
  requestAnimationFrame(() => freeze.remove());
  // The browser chrome follows the in-app theme, not the OS one; the colours match app/layout.tsx.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.removeAttribute("media");
    meta.content = dark ? "#1a1816" : "#faf9f6";
  }
  try {
    localStorage.setItem("chat-theme", dark ? "dark" : "light");
  } catch {
    // storage unavailable
  }
  for (const l of listeners) l();
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readDark,
    () => false,
  );
  return (
    <IconButton label={dark ? "Switch to light theme" : "Switch to dark theme"} tipSide="top" onClick={() => setDark(!dark)}>
      {dark ? <Sun /> : <Moon />}
    </IconButton>
  );
}
