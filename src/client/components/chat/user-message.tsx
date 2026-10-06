"use client";
import { Check, Copy, MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MessageState } from "@client/store/chat-store";
import { textOf } from "@client/store/chat-store";
import { useChatContext } from "./chat-context";

export function UserMessage({ message }: { message: MessageState }) {
  const { editMessage } = useChatContext();
  const [copied, setCopied] = useState(false);
  const text = textOf(message.blocks);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable
    }
  };
  return (
    <div className="group/user flex items-end justify-end gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="touch-target shrink-0 text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/user:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100"
            aria-label="Message actions"
          >
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem className="min-h-11" onClick={() => editMessage(message.id)}>
            <Pencil />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem className="min-h-11" onClick={onCopy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble bg-bubble px-4 py-2.5 text-body text-bubble-foreground md:max-w-[75%]">
        {text}
      </div>
    </div>
  );
}
