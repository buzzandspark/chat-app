"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** The chat route's error boundary: the shell stays, the thread area says what happened. */
export default function ChatError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[chat] route error", error);
  }, [error]);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-gutter text-center" role="alert">
      <p className="text-body">This chat could not be shown.</p>
      <p className="text-small text-muted-foreground">{error.digest ? `Reference ${error.digest}` : error.message}</p>
      <div className="flex gap-2">
        <Button variant="outline" className="touch-target" onClick={reset}>
          Try again
        </Button>
        <Button className="touch-target" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </div>
  );
}
