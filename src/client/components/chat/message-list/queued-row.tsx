"use client";
import { useSyncExternalStore } from "react";
import type { QueuedMessage } from "@client/store/chat-store";
import { useChatStore } from "@client/store/hooks";
import { useChatActions } from "../chat-context";

/** A message waiting for the streaming reply to end: shown where it will land, editable, removable. */
export function QueuedRow({ item, lastId }: { item: QueuedMessage; lastId: string | undefined }) {
  const { editQueued, removeQueued } = useChatActions();
  const store = useChatStore();
  // A failed reply leaves the queue to the user (GenerationClient.sendQueued); a boolean, so deltas don't re-render.
  const held = useSyncExternalStore(
    (cb) => (lastId ? store.subscribeMessage(lastId, cb) : () => {}),
    () => (lastId ? store.getMessage(lastId)?.status === "error" : false),
    () => false,
  );
  return (
    <div className="flex flex-col items-end gap-1" data-testid="queued-message">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble border border-dashed border-border bg-bubble/50 px-4 py-2.5 text-body text-bubble-foreground/80 md:max-w-[75%]">
        {item.text}
      </div>
      <div className="flex items-center gap-3 text-caption text-muted-foreground">
        <span>{held ? "Not sent: the reply failed." : "Queued, sends when the reply finishes"}</span>
        <button type="button" className="touch-target underline underline-offset-2 hover:text-foreground" onClick={() => editQueued(item.id)}>
          Edit
        </button>
        <button type="button" className="touch-target underline underline-offset-2 hover:text-foreground" onClick={() => removeQueued(item.id)}>
          Remove
        </button>
      </div>
    </div>
  );
}
