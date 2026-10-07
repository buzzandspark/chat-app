"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] route error", error);
  }, [error]);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-gutter py-12 text-center" role="alert">
      <p className="text-body">Something went wrong.</p>
      <p className="text-small text-muted-foreground">{error.digest ? `Reference ${error.digest}` : error.message}</p>
      <div className="flex gap-2">
        <Button variant="outline" className="touch-target" onClick={reset}>
          Try again
        </Button>
        <Button className="touch-target" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </main>
  );
}
