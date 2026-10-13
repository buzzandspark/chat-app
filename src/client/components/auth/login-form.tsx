"use client";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { newChatHref } from "@client/hooks/use-new-chat";
import { readJson, type AuthError } from "@shared/api";
import { safeNext } from "@shared/safe-next";

/** Back where sign-in was asked for; the `/c/new` alias goes straight to a new chat. */
function nextPath(): string {
  const next = safeNext(new URLSearchParams(window.location.search).get("next"));
  return next && new URL(next, window.location.origin).pathname !== "/c/new" ? next : newChatHref();
}

/** A text field of a submitted form ("" when absent). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Server-rendered (no `useSearchParams`, so no Suspense gap or heading jump); `next` is read at submit. A plain POST
 * instead of better-auth's React client (13 kB gzipped for one call); uncontrolled fields keep what was typed before hydration.
 */
export function LoginForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_previous: { error: string | null; email: string }, form: FormData) => {
      const email = formText(form, "email");
      const result = await signIn(email, formText(form, "password"));
      if (!result.ok) return { error: result.message, email };
      router.push(nextPath());
      router.refresh();
      return { error: null, email };
    },
    { error: null, email: "" },
  );

  return (
    <form action={formAction} className="space-y-4" aria-label="Sign in">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state.email} className="h-11 text-body" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required className="h-11 text-body" />
      </div>
      {state.error && !pending ? (
        <p role="alert" className="text-small text-destructive">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" className="touch-target w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

/** better-auth's email sign-in over fetch: the cookie arrives on the response; errors carry a message. */
export async function signIn(email: string, password: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) return { ok: true };
    const body: AuthError = await readJson<AuthError>(res).catch(() => ({}));
    return { ok: false, message: body.message ?? (res.status === 429 ? "Too many attempts. Try again in a moment." : "Sign-in failed") };
  } catch {
    return { ok: false, message: "Sign-in failed: you seem to be offline." };
  }
}
