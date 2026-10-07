"use client";
import { RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useNewChat } from "@client/hooks/use-new-chat";
import { useNow } from "@client/hooks/use-now";
import type { MessageState } from "@client/store/chat-store";
import { modelDisplayName } from "@shared/models";

interface StatusFooterProps {
  message: MessageState;
  onRetry: () => void;
  onContinue: () => void;
  onResume: () => void;
}

function Countdown({ until }: { until: number }) {
  const now = useNow(500);
  if (now === 0) return <span>a moment</span>;
  return <span>{Math.max(0, Math.ceil((until - now) / 1000))}s</span>;
}

/** D17: every terminal and non-terminal state has its own wording and action. */
export function StatusFooter({ message, onRetry, onContinue, onResume }: StatusFooterProps) {
  const newChat = useNewChat();
  const action = (label: ReactNode, onClick: () => void) => (
    <Button size="sm" variant="outline" className="touch-target" onClick={onClick}>
      {label}
    </Button>
  );
  const retry = action(
    <>
      <RefreshCw data-icon="inline-start" />
      Retry
    </>,
    onRetry,
  );
  const link = (href: string, label: string) => (
    <Link className="underline" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
      {label}
    </Link>
  );
  // What to say, what to offer, and whether the browser should announce it.
  let text: ReactNode;
  let offer: ReactNode = null;
  let live = false;
  let offline = false;

  if (message.status === "streaming") {
    // The composer owns the stop control while the stream is healthy.
    if (message.connection !== "reconnecting" && message.connection !== "offline") return null;
    live = true;
    if (message.connection === "reconnecting") {
      text = <span className="animate-pulse">Reconnecting{message.reconnectAttempt > 0 ? ` (attempt ${message.reconnectAttempt + 1})` : ""}…</span>;
    } else {
      offline = true;
      text = "You're offline. The reply keeps generating on the server.";
      offer = action("Retry now", onResume);
    }
  } else if (message.status === "stopped") {
    text = "Stopped.";
    offer = retry;
  } else if (message.status === "interrupted") {
    const why =
      message.interruptedReason === "shutdown" || message.interruptedReason === "crash"
        ? "the server restarted"
        : message.interruptedReason === "upstream"
          ? "the connection to the model dropped"
          : "something interrupted it";
    text = `Interrupted: ${why}. What arrived is kept.`;
    offer = retry;
  } else if (message.status === "refused") {
    const r = message.refusal;
    text =
      r?.category && r.explanation
        ? `Claude declined (${r.category}): ${r.explanation}`
        : r?.category
          ? `Claude declined this request (${r.category}).`
          : "Claude declined to continue this response.";
  } else if (message.status === "error") {
    const e = message.error;
    switch (e?.kind) {
      case "rate_limited":
        text = (
          <>
            Rate limited. Try again in <Countdown until={message.createdAt + (e.retryAfterMs ?? 15_000)} />.
          </>
        );
        offer = retry;
        break;
      case "overloaded":
        text = "Claude is overloaded right now.";
        offer = retry;
        break;
      case "api_error":
        text = "The model provider had an error.";
        offer = retry;
        break;
      case "auth":
        text = "The server's API key is not working. An admin needs to fix the deployment.";
        break;
      case "session":
        text = "Your session has ended.";
        offer = link("/login", "Sign in again");
        break;
      case "forbidden":
        text = "This chat belongs to another account.";
        offer = action("New chat", newChat);
        break;
      case "quota_exceeded":
        text = "You have used the whole budget on this instance.";
        offer = link("https://github.com/bzahory/cadence/blob/main/docs/self-host.md", "Run your own");
        break;
      case "context_full":
        text = "This chat is too long to continue.";
        offer = action("Start a new chat", newChat);
        break;
      case "network":
      case "offline":
        offline = true;
        text = "Lost the connection.";
        offer = retry;
        break;
      default:
        text = e?.message ?? "Something went wrong.";
        offer = retry;
    }
  } else if (message.status === "done" && message.stopReason === "max_tokens") {
    text = "Cut off at the output limit.";
    offer = action("Continue", onContinue);
  } else {
    return null;
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted-foreground" role={live ? "status" : undefined}>
      {offline ? <WifiOff className="size-4" /> : null}
      <span>{text}</span>
      {offer}
    </div>
  );
}

export function ServedBy({ message }: { message: MessageState }) {
  if (!message.servingModel || !message.requestedModel || message.servingModel === message.requestedModel) return null;
  return (
    <span className="text-caption text-muted-foreground">Served by {modelDisplayName(message.servingModel)}</span>
  );
}
