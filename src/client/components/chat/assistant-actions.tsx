"use client";
import { Check, Copy, MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../ui/icon-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MessageState } from "@client/store/chat-store";
import { LatencyPopover } from "./latency-popover";
import { ServedBy } from "./status-footer";

interface AssistantActionsProps {
  message: MessageState;
  text: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
  /** Which stand-in the user pressed before this chunk had loaded. */
  defaultOpen?: "menu" | "latency" | null;
}

/** Loaded after first paint (D21): the menu and popover pull in Radix, which the first frame does not need. */
export function AssistantActions({ message, text, canRegenerate, onRegenerate, defaultOpen = null }: AssistantActionsProps) {
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState(defaultOpen === "menu");
  // Copy keeps the menu open long enough to show "Copied", then closes it (#68).
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
      <LatencyPopover timings={message.timings} usage={message.usage} defaultOpen={defaultOpen === "latency"} />
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton
            label="Message actions"
            className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100"
          >
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
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
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
