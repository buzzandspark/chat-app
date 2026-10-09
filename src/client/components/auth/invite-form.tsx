"use client";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formText, signIn } from "./login-form";
import { newChatHref } from "@client/hooks/use-new-chat";

/** D23: set a password through the invite, then sign in with it (a form action; the browser checks the length). */
export function InviteForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [error, formAction, pending] = useActionState(async (_previous: string | null, form: FormData) => {
    const password = formText(form, "password");
    let res: Response;
    try {
      res = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
    } catch {
      // Returned, not thrown: a throw inside an action would replace the page with the error boundary.
      return "Setting the password failed: you seem to be offline.";
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return body.error === "weak_password" ? "Use at least 10 characters." : "This invite could not be used.";
    }
    const result = await signIn(email, password);
    if (!result.ok) return result.message;
    router.push(newChatHref());
    router.refresh();
    return null;
  }, null);

  return (
    <form action={formAction} className="space-y-4" aria-label="Set password">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} readOnly className="h-11 text-body" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={10} className="h-11 text-body" />
        <p className="text-caption text-muted-foreground">At least 10 characters.</p>
      </div>
      {error && !pending ? (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="touch-target w-full" disabled={pending}>
        {pending ? "Saving…" : "Set password and sign in"}
      </Button>
    </form>
  );
}
