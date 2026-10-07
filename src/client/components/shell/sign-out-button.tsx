"use client";
import { LogOut } from "lucide-react";
import { authClient } from "@auth/client";
import { IconButton } from "../ui/icon-button";

/** A full navigation afterwards: the client store, drafts in memory and the router cache all belong to the old session. */
export function SignOutButton() {
  const signOut = async () => {
    try {
      await authClient.signOut();
    } catch {
      // The cookie may already be gone; the login page is the right place either way.
    }
    // A full document load, not router.push: nothing of the old session may survive in memory.
    window.location.assign(new URL("/login", window.location.origin).href);
  };
  return (
    <IconButton label="Sign out" tipSide="top" tipAlign="end" onClick={() => void signOut()} data-testid="sign-out">
      <LogOut />
    </IconButton>
  );
}
