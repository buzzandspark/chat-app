"use client";
import { MoreHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import type { MessageState } from "@client/store/chat-store";
import { textOf } from "@client/store/chat-store";
import { ChunkBoundary } from "../ui/chunk-boundary";
import { useChatContext } from "./chat-context";

const UserActions = dynamic(() => import("./user-actions").then((m) => m.UserActions), {
  ssr: false,
  loading: () => (
    <Button variant="ghost" size="icon" className="touch-target shrink-0 text-muted-foreground opacity-0" aria-hidden disabled>
      <MoreHorizontal />
    </Button>
  ),
});

export function UserMessage({ message }: { message: MessageState }) {
  const { editMessage } = useChatContext();
  const text = textOf(message.blocks);
  return (
    <div className="group/user flex items-end justify-end gap-1">
      <ChunkBoundary label="message actions">
        <UserActions text={text} onEdit={() => editMessage(message.id)} />
      </ChunkBoundary>
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble bg-bubble px-4 py-2.5 text-body text-bubble-foreground md:max-w-[75%]">
        {text}
      </div>
    </div>
  );
}
