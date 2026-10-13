"use client";
import { LogOut } from "lucide-react";
import { IconButton } from "@client/components/ui/icon-button";

/**
 * A plain POST, not the auth client (13 kB gzipped, kept off the chat route). A full navigation afterwards: the client
 * store, in-memory drafts and the router cache all belong to the old session.
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
    <IconButton label="Sign out" tipSide="top" onClick={() => void signOut()} data-testid="sign-out">
      <LogOut />
    </IconButton>
  );
}
