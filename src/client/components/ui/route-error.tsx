"use client";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** What could not be shown; the chat route keeps its shell around this. */
  what: string;
  main?: boolean;
}

/** One error view for the root and the chat route: what failed, a reference, try again or reload. */
export function RouteError({ error, reset, what, main }: RouteErrorProps) {
  useEffect(() => {
    console.error(`[${what}] route error`, error);
  }, [error, what]);
  const Tag = main ? "main" : "div";
  return (
    <Tag className="flex flex-1 flex-col items-center justify-center gap-3 px-gutter py-12 text-center" role="alert">
      <p className="text-body">{main ? "Something went wrong." : "This chat could not be shown."}</p>
      <p className="text-small text-muted-foreground">{error.digest ? `Reference ${error.digest}` : error.message}</p>
      <div className="flex gap-2">
        <Button variant="outline" className="touch-target" onClick={reset}>
          Try again
        </Button>
        <Button className="touch-target" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </Tag>
  );
}
