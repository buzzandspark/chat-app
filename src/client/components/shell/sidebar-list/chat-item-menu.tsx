"use client";
import { GitFork, ListX, MoreHorizontal, Pencil, Pin, PinOff, Trash2, Trophy } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Ref } from "react";
import { IconButton } from "../../ui/icon-button";

const BUTTON =
  "size-10 shrink-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100";

export function ChatItemMenu({
  title,
  pinned = false,
  onRename,
  onDelete,
  onTogglePin,
  onDeleteAll,
  onDeclareWinner,
  onDeleteForks,
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
  /** A fork: it stays alone, the main chat and the other forks are deleted. */
  onDeclareWinner?: () => void;
  /** A main chat with forks: deletes the forks, the main chat stays. */
  onDeleteForks?: () => void;
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
      <DropdownMenuContent align="end" className="w-max" onCloseAutoFocus={onCloseAutoFocus}>
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
        {onDeclareWinner ? (
          <DropdownMenuItem className="min-h-11" onSelect={onDeclareWinner}>
            <Trophy className="text-warning" />
            Declare winner
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
        {onDeleteForks ? (
          <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={onDeleteForks}>
            <GitFork />
            Delete forks
          </DropdownMenuItem>
        ) : null}
        {onDeleteAll ? (
          <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={onDeleteAll}>
            <ListX />
            Delete chat and forks
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
