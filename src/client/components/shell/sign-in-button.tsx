"use client";
import { LogIn } from "lucide-react";
import { useRouter } from "next/navigation";
import { IconButton } from "@client/components/ui/icon-button";

/** A guest's way to an account, in the slot where an account's Sign out sits; it comes back here after. */
export function SignInButton() {
  const router = useRouter();
  return (
    <IconButton
      label="Sign in"
      tipSide="top"
      onClick={() => router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`)}
      data-testid="sign-in"
    >
      <LogIn />
    </IconButton>
  );
}
