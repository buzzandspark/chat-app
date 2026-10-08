"use client";
import { MoreHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { IconButton } from "../ui/icon-button";
import type { MessageState } from "@client/store/chat-store";
import { textOf } from "@client/store/chat-store";
import { ChunkBoundary } from "../ui/chunk-boundary";
import { lazyChunk } from "../ui/lazy-chunk";
import { useChatActions } from "./chat-context";

const USER_ACTION_BUTTON =
  "shrink-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/user:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100";
const UserActions = lazyChunk(() =>
  dynamic(() => import("./user-actions").then((m) => m.UserActions), {
    ssr: false,
    loading: () => (
      <IconButton label="Message actions" className={USER_ACTION_BUTTON} disabled>
        <MoreHorizontal />
      </IconButton>
    ),
  }),
);

/** D21: the menu's chunk loads on intent; the stand-in is the same button. */
const warmUserActions = () => import("./user-actions");

function UserActionsOnIntent(props: { text: string; onEdit: () => void }) {
  const intent = useIntent(warmUserActions);
  if (intent.armed) return <UserActions {...props} defaultOpen={intent.wanted === "menu"} />;
  return (
    <IconButton label="Message actions" className={USER_ACTION_BUTTON} {...intentProps(intent)} onClick={() => intent.press("menu")}>
      <MoreHorizontal />
    </IconButton>
  );
}

export function UserMessage({ message }: { message: MessageState }) {
  const { editMessage } = useChatActions();
  const text = textOf(message.blocks);
  return (
    <div className="group/user flex items-end justify-end gap-1">
      <ChunkBoundary label="message actions">
        <UserActionsOnIntent text={text} onEdit={() => editMessage(message.id)} />
      </ChunkBoundary>
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble bg-bubble px-4 py-2.5 text-body text-bubble-foreground md:max-w-[75%]">
        {text}
      </div>
    </div>
  );
}
