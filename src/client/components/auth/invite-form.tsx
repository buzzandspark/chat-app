"use client";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteProblem } from "./invite-problem";
import { formText, signIn } from "./login-form";
import { newChatHref } from "@client/hooks/use-new-chat";
import { readJson, type ApiError } from "@shared/api";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@shared/types";

const LENGTH_RULE = `${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`;

/** Set a password through the invite, then sign in with it (a form action; the browser checks the length). */
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
      return "You're offline. Try again when you're connected.";
    }
    if (!res.ok) {
      const body: Partial<ApiError> = await readJson<ApiError>(res).catch(() => ({}));
      if (body.error === "weak_password") return `Use ${LENGTH_RULE}`;
      return res.status === 410 && body.error ? inviteProblem(body.error) : "Couldn't set the password. Try again.";
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
        <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} className="h-11 text-body" />
        <p className="text-caption text-muted-foreground">{LENGTH_RULE}</p>
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
