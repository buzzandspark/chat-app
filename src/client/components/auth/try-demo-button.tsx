"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { newChatHref } from "@client/hooks/use-new-chat";

/** ADR-0004: one tap creates a private 24 h demo user; no login wall. */
export function TryDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/start", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      router.push(newChatHref());
      router.refresh();
    } catch {
      setError("The demo could not start. Try again in a moment.");
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" className="touch-target" onClick={() => void start()} disabled={busy} data-testid="try-demo">
        {busy ? "Starting…" : "Try the demo"}
      </Button>
      {error ? (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
