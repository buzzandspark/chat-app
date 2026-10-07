"use client";
import { Check, Copy, MoreHorizontal, Pencil } from "lucide-react";
import { useState } from "react";
import { IconButton } from "../ui/icon-button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function UserActions({ text, onEdit }: { text: string; onEdit: () => void }) {
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          label="Message actions"
          className="shrink-0 text-muted-foreground [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/user:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100"
        >
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem className="min-h-11" onSelect={onEdit}>
          <Pencil />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" onSelect={onCopy}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
