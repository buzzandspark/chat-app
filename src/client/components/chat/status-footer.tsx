"use client";
import { RefreshCw, Square, WifiOff } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useNow } from "@client/hooks/use-now";
import type { MessageState } from "@client/store/chat-store";
import { modelDisplayName } from "@shared/models";

interface StatusFooterProps {
  message: MessageState;
  onRetry: () => void;
  onContinue: () => void;
  onStop: () => void;
  onResume: () => void;
}

function Countdown({ until }: { until: number }) {
  const now = useNow(500);
  if (now === 0) return <span>a moment</span>;
  return <span>{Math.max(0, Math.ceil((until - now) / 1000))}s</span>;
}

/** D17: every terminal and non-terminal state has its own wording and action. */
export function StatusFooter({ message, onRetry, onContinue, onStop, onResume }: StatusFooterProps) {
  const base = "mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground";
  const retry = (
    <Button size="sm" variant="outline" className="touch-target" onClick={onRetry}>
      <RefreshCw data-icon="inline-start" />
      Retry
    </Button>
  );

  if (message.status === "streaming") {
    if (message.connection === "reconnecting") {
      return (
        <div className={base} role="status">
          <span className="animate-pulse">Reconnecting{message.reconnectAttempt > 0 ? ` (attempt ${message.reconnectAttempt + 1})` : ""}…</span>
        </div>
      );
    }
    if (message.connection === "offline") {
      return (
        <div className={base} role="status">
          <WifiOff className="size-4" />
          <span>You&apos;re offline. The reply keeps generating on the server.</span>
          <Button size="sm" variant="outline" className="touch-target" onClick={onResume}>
            Retry now
          </Button>
        </div>
      );
    }
    return (
      <div className={base}>
        <Button size="sm" variant="ghost" className="touch-target" onClick={onStop} aria-label="Stop generating">
          <Square data-icon="inline-start" className="fill-current" />
          Stop
        </Button>
      </div>
    );
  }

  switch (message.status) {
    case "stopped":
      return (
        <div className={base}>
          <span>Stopped.</span>
          {retry}
        </div>
      );
    case "interrupted": {
      const why =
        message.interruptedReason === "shutdown" || message.interruptedReason === "crash"
          ? "the server restarted"
          : message.interruptedReason === "upstream"
            ? "the connection to the model dropped"
            : "something interrupted it";
      return (
        <div className={base}>
          <span>Interrupted: {why}. What arrived is kept.</span>
          {retry}
        </div>
      );
    }
    case "refused": {
      const r = message.refusal;
      const text =
        r?.category && r.explanation
          ? `Claude declined (${r.category}): ${r.explanation}`
          : r?.category
            ? `Claude declined this request (${r.category}).`
            : "Claude declined to continue this response.";
      return (
        <div className={base}>
          <span>{text}</span>
        </div>
      );
    }
    case "error": {
      const e = message.error;
      switch (e?.kind) {
        case "rate_limited":
          return (
            <div className={base}>
              <span>
                Rate limited. Try again in <Countdown until={message.createdAt + (e.retryAfterMs ?? 15_000)} />.
              </span>
              {retry}
            </div>
          );
        case "overloaded":
        case "api_error":
          return (
            <div className={base}>
              <span>{e.kind === "overloaded" ? "Claude is overloaded right now." : "The model provider had an error."}</span>
              {retry}
            </div>
          );
        case "auth":
          return (
            <div className={base}>
              <span>The server&apos;s API key is not working. An admin needs to fix the deployment.</span>
            </div>
          );
        case "quota_exceeded":
          return (
            <div className={base}>
              <span>You have used the whole budget on this instance.</span>
              <Link className="underline" href="https://github.com/bzahory/cadence/blob/main/docs/self-host.md" target="_blank" rel="noreferrer">
                Run your own
              </Link>
            </div>
          );
        case "context_full":
          return (
            <div className={base}>
              <span>This chat is too long to continue.</span>
              <Button asChild size="sm" variant="outline" className="touch-target">
                <Link href="/c/new">Start a new chat</Link>
              </Button>
            </div>
          );
        case "network":
        case "offline":
          return (
            <div className={base}>
              <WifiOff className="size-4" />
              <span>Lost the connection.</span>
              {retry}
            </div>
          );
        default:
          return (
            <div className={base}>
              <span>{e?.message ?? "Something went wrong."}</span>
              {retry}
            </div>
          );
      }
    }
    case "done":
      if (message.stopReason === "max_tokens") {
        return (
          <div className={base}>
            <span>Cut off at the output limit.</span>
            <Button size="sm" variant="outline" className="touch-target" onClick={onContinue}>
              Continue
            </Button>
          </div>
        );
      }
      return null;
    default:
      return null;
  }
}

export function ServedBy({ message }: { message: MessageState }) {
  if (!message.servingModel || !message.requestedModel || message.servingModel === message.requestedModel) return null;
  return (
    <span className="text-caption text-muted-foreground">Served by {modelDisplayName(message.servingModel)}</span>
  );
}
