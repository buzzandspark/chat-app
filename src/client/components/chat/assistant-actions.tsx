"use client";
import { Check, Copy, GitFork, MoreHorizontal, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconButton } from "../ui/icon-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MessageState } from "@client/store/chat-store";
import { duplicateChat } from "@client/store/fork-chat";
import { useChat, useChatStore } from "@client/store/hooks";
import { useSidebarChats } from "@client/store/sidebar-store";
import { MAX_FORKS } from "@shared/forks";
import { ServedBy } from "./status-footer";

interface AssistantActionsProps {
  message: MessageState;
  text: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
  /** Which stand-in the user pressed before this chunk had loaded. */
  defaultOpen?: "menu" | null;
}

/** Loaded after first paint: the menu pulls in Radix, which the first frame does not need. */
export function AssistantActions({ message, text, canRegenerate, onRegenerate, defaultOpen = null }: AssistantActionsProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(defaultOpen === "menu");
  const [error, setError] = useState<string | null>(null);
  const store = useChatStore();
  const router = useRouter();
  // Copy from here makes another fork of the main chat, so it's offered while the main chat has room for one, and never on a failed reply.
  const parentId = useChat(message.chatId).forkedFrom ?? message.chatId;
  const roomForFork = useSidebarChats().filter((c) => c.forkedFrom === parentId).length < MAX_FORKS;
  const canCopy = message.status !== "error" && roomForFork;
  const onFork = () => {
    setError(null);
    void duplicateChat(store, router, message.chatId, message.id).then((out) => {
      if (out.error) setError(out.error);
    });
  };
  // Copy keeps the menu open long enough to show "Copied", then closes it.
  const onCopy = async (e: Event) => {
    e.preventDefault();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1200);
    } catch {
      setOpen(false);
    }
  };
  return (
    <div className="flex items-center gap-1">
      <ServedBy message={message} />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton
            label="Message actions"
            className="first:-ml-3.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100"
          >
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-max">
          <DropdownMenuItem onSelect={onCopy} className="min-h-11">
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </DropdownMenuItem>
          {canRegenerate ? (
            <DropdownMenuItem onSelect={onRegenerate} className="min-h-11">
              <RefreshCw />
              Regenerate
            </DropdownMenuItem>
          ) : null}
          {canCopy ? (
            <DropdownMenuItem onSelect={onFork} className="min-h-11">
              <GitFork />
              Copy from here
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {error ? (
        <span role="alert" className="text-caption text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
