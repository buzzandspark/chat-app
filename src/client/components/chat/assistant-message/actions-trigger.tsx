"use client";
import { MoreHorizontal } from "lucide-react";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { IconButton } from "@client/components/ui/icon-button";
import type { MessageState } from "@client/store/chat-store";
import { chunk } from "@client/components/ui/lazy-chunk";
import { ServedBy } from "./status-footer";

// The menu (Radix) loads on first intent; the stand-in keeps the row's height. It's never `disabled`:
// that dims a button, so it blinked as the real one replaced it.
// first:-ml-3.5: the icon sits on the text's left edge (the 44 px target centres a 16 px icon) unless "Served by" leads the row.
const ACTION_BUTTON =
  "first:-ml-3.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100";

function ActionsStandIn({
  message,
  intent,
  onPress,
}: {
  message: MessageState;
  intent: { warmUp: () => void };
  onPress: (what: string) => void;
}) {
  return (
    <div className="flex items-center gap-1" {...intentProps(intent)}>
      <ServedBy message={message} />
      <IconButton label="Message actions" className={ACTION_BUTTON} onClick={() => onPress("menu")}>
        <MoreHorizontal />
      </IconButton>
    </div>
  );
}
const loadAssistantActions = chunk(() => import("./assistant-actions").then((m) => m.AssistantActions));

export function AssistantActionsOnIntent(props: { message: MessageState; text: string; canRegenerate: boolean; onRegenerate: () => void }) {
  const intent = useIntent(loadAssistantActions);
  if (intent.failed) throw intent.failed.error;
  const AssistantActions = intent.loaded;
  if (intent.armed && AssistantActions) return <AssistantActions {...props} defaultOpen={intent.wanted === "menu" ? "menu" : null} />;
  return <ActionsStandIn message={props.message} intent={intent} onPress={intent.press} />;
}
