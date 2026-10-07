"use client";
import { LogOut } from "lucide-react";
import { IconButton } from "../ui/icon-button";

/**
 * A plain POST to better-auth's endpoint, not the auth client: the client library (with its store
 * dependency) is 13 kB gzipped and belongs to the login and invite pages, not the chat route (D21).
 * A full navigation afterwards: the client store, drafts in memory and the router cache all belong
 * to the old session.
 */
export function SignOutButton() {
  const signOut = async () => {
    try {
      await fetch("/api/auth/sign-out", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    } catch {
      // The cookie may already be gone; the login page is the right place either way.
    }
    window.location.assign(new URL("/login", window.location.origin).href);
  };
  return (
    <IconButton label="Sign out" tipSide="top" tipAlign="end" onClick={() => void signOut()} data-testid="sign-out">
      <LogOut />
    </IconButton>
  );
}
