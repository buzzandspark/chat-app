"use client";
import { ListX, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Ref } from "react";
import { IconButton } from "../ui/icon-button";

const BUTTON =
  "size-10 shrink-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100";

export function ChatItemMenu({
  title,
  pinned = false,
  onRename,
  onDelete,
  onTogglePin,
  onDeleteAll,
  defaultOpen,
  triggerRef,
  onCloseAutoFocus,
}: {
  title: string;
  pinned?: boolean;
  onRename: () => void;
  onDelete: () => void;
  onTogglePin?: () => void;
  /** A main chat with forks: deletes it and every fork. */
  onDeleteAll?: () => void;
  /** True when the user pressed the stand-in before this chunk had loaded. */
  defaultOpen?: boolean;
  /** The row's intent: it swaps back to the stand-in once Radix has returned focus here (useIntent's `closed`). */
  triggerRef?: Ref<HTMLButtonElement>;
  onCloseAutoFocus?: () => void;
}) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <IconButton ref={triggerRef} label={`Actions for ${title}`} tip={false} className={BUTTON}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus}>
        {onTogglePin ? (
          <DropdownMenuItem className="min-h-11" onSelect={onTogglePin}>
            {pinned ? <PinOff /> : <Pin />}
            {pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="min-h-11" onSelect={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
        {onDeleteAll ? (
          <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={onDeleteAll}>
            <ListX />
            Delete group
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
