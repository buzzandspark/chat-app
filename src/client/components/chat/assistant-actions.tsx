"use client";
import { Check, Copy, MoreHorizontal, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { MessageState } from "@client/store/chat-store";
import { LatencyPopover } from "./latency-popover";
import { ServedBy } from "./status-footer";

interface AssistantActionsProps {
  message: MessageState;
  text: string;
  canRegenerate: boolean;
  onRegenerate: () => void;
}

/** Loaded after first paint (D21): the menu and popover pull in Radix, which the first frame does not need. */
export function AssistantActions({ message, text, canRegenerate, onRegenerate }: AssistantActionsProps) {
  const [copied, setCopied] = useState(false);
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
    <div className="flex items-center gap-1">
      <ServedBy message={message} />
      <LatencyPopover timings={message.timings} usage={message.usage} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="touch-target text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100"
            aria-label="Message actions"
          >
            <MoreHorizontal />
          </Button>
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
