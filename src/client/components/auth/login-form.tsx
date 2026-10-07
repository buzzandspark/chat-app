"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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

/**
 * Server-rendered (no `useSearchParams`, so no Suspense gap and no heading jump, #52); `next` is read
 * from the URL at submit. One plain POST to better-auth's sign-in endpoint instead of its React client
 * (13 kB gzipped for one call, #81).
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Adopt values typed before hydration so the controlled inputs do not drop them.
  useEffect(() => {
    const early = { email: emailRef.current?.value ?? "", password: passwordRef.current?.value ?? "" };
    const frame = requestAnimationFrame(() => {
      if (early.email) setEmail((v) => (v === "" ? early.email : v));
      if (early.password) setPassword((v) => (v === "" ? early.password : v));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    const next = safeNext(new URLSearchParams(window.location.search).get("next"));
    router.push(next ?? newChatHref());
    router.refresh();
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Sign in">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input ref={emailRef} id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 text-body" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input ref={passwordRef} id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-11 text-body" />
      </div>
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="touch-target w-full" disabled={busy}>
        {busy ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-small text-muted-foreground">
        <Link href="/" className="underline">
          Back
        </Link>
      </p>
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
