"use client";
import { RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useNewChat } from "@client/hooks/use-new-chat";
import { useNow } from "@client/hooks/use-now";
import { errorText } from "@client/store/announcer";
import type { MessageState } from "@client/store/chat-store";
import { modelDisplayName } from "@shared/models";
import { isLongWait, MAX_AUTO_RETRIES, rateLimitDelayMs, waitText } from "./rate-limit";

interface StatusFooterProps {
  message: MessageState;
  /** Absent for a failed reply that a newer turn follows: it keeps its error but offers no retry. */
  onRetry?: () => void;
  onContinue: () => void;
  onResume: () => void;
}

function Countdown({ until }: { until: number }) {
  const now = useNow(500);
  if (now === 0) return <span>a moment</span>;
  return <span>{Math.max(0, Math.ceil((until - now) / 1000))}s</span>;
}

function WaitLeft({ until }: { until: number }) {
  const now = useNow(30_000);
  if (now === 0) return <span>a while</span>;
  return <span>{waitText(until - now)}</span>;
}

/** Every terminal and non-terminal state has its own wording and action. */
export function StatusFooter({ message, onRetry, onContinue, onResume }: StatusFooterProps) {
  const newChat = useNewChat();
  const action = (label: ReactNode, onClick: () => void) => (
    <Button size="sm" variant="outline" className="touch-target" onClick={onClick}>
      {label}
    </Button>
  );
  const retry = onRetry
    ? action(
        <>
          <RefreshCw data-icon="inline-start" />
          Retry
        </>,
        onRetry,
      )
    : null;
  const link = (href: string, label: string) => (
    <Link className="underline" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">
      {label}
    </Link>
  );
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
      text = "Can't reach the server. The reply continues there.";
      offer = action("Reconnect", onResume);
    }
  } else if (message.status === "stopped") {
    text = "Stopped.";
    offer = retry;
  } else if (message.status === "interrupted") {
    // The reason isn't saved with the message, so a reloaded reply has none.
    const why =
      message.interruptedReason === "shutdown" || message.interruptedReason === "crash"
        ? ": the server restarted"
        : message.interruptedReason === "upstream"
          ? ": Claude stopped responding"
          : "";
    text = `Interrupted${why}. What arrived is kept.`;
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
    text = errorText(e);
    switch (e?.kind) {
      case "rate_limited": {
        // Inline, not a button: the row keeps the height of a line of text, so the footer appearing shifts nothing.
        const retryInline = onRetry ? (
          <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={onRetry}>
            Retry
          </button>
        ) : null;
        if (isLongWait(e.retryAfterMs)) {
          text = (
            <>
              Busy right now. Try again in <WaitLeft until={message.createdAt + (e.retryAfterMs ?? 0)} />
              {retryInline ? <>, or {retryInline} now</> : null}.
            </>
          );
          break;
        }
        const exhausted = message.retryAttempt >= MAX_AUTO_RETRIES;
        // No retry offered means no countdown either: the automatic retry stops along with Retry.
        const auto = retryInline !== null && message.local && !exhausted;
        if (auto) {
          text = (
            <>
              Rate limited. Retrying in <Countdown until={message.createdAt + rateLimitDelayMs(message.retryAttempt, e.retryAfterMs)} />, or {retryInline} now.
            </>
          );
        } else if (exhausted) {
          // After every automatic try, no more retries are offered: a new message is the way on.
          text = "Still rate limited. Try again later.";
        } else if (retryInline) {
          text = <>Rate limited. {retryInline}.</>;
        }
        break;
      }
      case "session":
        offer = link("/login", "Sign in again");
        break;
      case "forbidden":
      case "gone":
      case "context_full":
        offer = action("New chat", newChat);
        break;
      case "unavailable":
        text = onRetry ? "The server is restarting. Retry in a few seconds." : "The server was restarting.";
        offer = retry;
        break;
      case "conflict":
        // Nothing was added on the server. A retry would only be refused again once another
        // request has replaced these turns: show what the server has instead.
        offer = e.retryable ? retry : action("Reload", () => window.location.reload());
        break;
      case "guests_blocked":
        offer = link("/login", "Sign in");
        break;
      case "offline":
        offline = true;
        offer = retry;
        break;
      case "auth":
      case "quota_exceeded":
      case "quota_short":
        break;
      default:
        offer = e?.retryable ? retry : null;
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
