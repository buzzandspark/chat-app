"use client";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";

const listeners = new Set<() => void>();
function readDark(): boolean {
  return document.documentElement.classList.contains("dark");
}
function setDark(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  try {
    localStorage.setItem("cadence-theme", dark ? "dark" : "light");
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
    <Button
      variant="ghost"
      size="icon"
      className="touch-target"
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={() => setDark(!dark)}
    >
      {dark ? <Sun /> : <Moon />}
    </Button>
  );
}
