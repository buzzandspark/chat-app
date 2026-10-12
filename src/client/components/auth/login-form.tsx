"use client";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { newChatHref } from "@client/hooks/use-new-chat";

/** Only a same-origin path, resolved the way the browser would (so `/\t/evil` and friends cannot leave the origin). */
function safeNext(next: string | null): string | null {
  if (!next) return null;
  try {
    const url = new URL(next, window.location.origin);
    if (url.origin !== window.location.origin || url.pathname === "/c/new") return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

/** A text field of a submitted form ("" when absent). */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Server-rendered (no `useSearchParams`, so no Suspense gap and no heading jump, #52); `next` is read
 * from the URL at submit. One plain POST to better-auth's sign-in endpoint instead of its React client
 * (13 kB gzipped for one call, #81). A form action with uncontrolled fields: what was typed before
 * hydration is simply in the fields, and a failed attempt keeps the email (the form resets to its default).
 */
export function LoginForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(
    async (_previous: { error: string | null; email: string }, form: FormData) => {
      const email = formText(form, "email");
      const result = await signIn(email, formText(form, "password"));
      if (!result.ok) return { error: result.message, email };
      const next = safeNext(new URLSearchParams(window.location.search).get("next"));
      router.push(next ?? newChatHref());
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
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    return { ok: false, message: body.message ?? (res.status === 429 ? "Too many attempts. Try again in a moment." : "Sign-in failed") };
  } catch {
    return { ok: false, message: "Sign-in failed: you seem to be offline." };
  }
}
