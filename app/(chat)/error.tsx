"use client";
import { RouteError } from "@client/components/ui/route-error";

/** The chat route's boundary: the shell stays, the thread area says what happened. */
export default function ChatError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} what="chat" />;
}
