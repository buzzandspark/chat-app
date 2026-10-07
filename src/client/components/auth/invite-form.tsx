"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "./login-form";
import { newChatHref } from "@client/hooks/use-new-chat";

/** D23: set a password through the invite, then sign in with it. */
export function InviteForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Adopt a password typed before hydration (a fast user, or WebKit under test), or the submit button never enables.
  useEffect(() => {
    const el = passwordRef.current;
    const typedEarly = el && el.value !== "" ? el.value : null;
    const frame = requestAnimationFrame(() => {
      if (typedEarly !== null) setPassword((v) => (v === "" ? typedEarly : v));
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error === "weak_password" ? "Use at least 10 characters." : "This invite could not be used.");
      setBusy(false);
      return;
    }
    const result = await signIn(email, password);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.push(newChatHref());
    router.refresh();
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" aria-label="Set password">
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" type="email" value={email} readOnly className="h-11 text-body" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          ref={passwordRef}
          id="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 text-body"
        />
        <p className="text-caption text-muted-foreground">At least 10 characters.</p>
      </div>
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="touch-target w-full" disabled={busy || password.length < 10}>
        {busy ? "Saving…" : "Set password and sign in"}
      </Button>
    </form>
  );
}
