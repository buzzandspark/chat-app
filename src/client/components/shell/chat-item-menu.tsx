"use client";
import { Check, ChevronRight, FolderInput, FolderMinus, FolderPlus, MoreHorizontal, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Ref } from "react";
import type { GroupSummary } from "@client/store/sidebar-store";
import { IconButton } from "../ui/icon-button";

const BUTTON =
  "size-10 shrink-0 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground dark:hover:bg-foreground/15 dark:aria-expanded:bg-foreground/15 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/item:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100 [@media(hover:hover)]:aria-expanded:opacity-100";

export function ChatItemMenu({
  title,
  pinned = false,
  groupId = null,
  groups = [],
  onRename,
  onDelete,
  onTogglePin,
  onMoveToGroup,
  onNewGroup,
  defaultOpen,
  triggerRef,
  onCloseAutoFocus,
}: {
  title: string;
  pinned?: boolean;
  groupId?: string | null;
  groups?: GroupSummary[];
  onRename: () => void;
  onDelete: () => void;
  onTogglePin?: () => void;
  onMoveToGroup?: (groupId: string | null) => void;
  onNewGroup?: () => void;
  /** True when the user pressed the stand-in before this chunk had loaded. */
  defaultOpen?: boolean;
  /** The row's intent: it swaps back to the stand-in once Radix has returned focus here (useIntent's `closed`). */
  triggerRef?: Ref<HTMLButtonElement>;
  onCloseAutoFocus?: () => void;
}) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <IconButton ref={triggerRef} label={`Actions for ${title}`} className={BUTTON}>
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
        {onMoveToGroup ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="min-h-11">
              <FolderInput />
              Move to
              <ChevronRight className="ml-auto" />
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {groups.map((g) => (
                <DropdownMenuItem key={g.id} className="min-h-11" onSelect={() => onMoveToGroup(g.id)}>
                  {g.id === groupId ? <Check /> : <span className="size-4" aria-hidden />}
                  {g.name}
                </DropdownMenuItem>
              ))}
              {groups.length > 0 ? <DropdownMenuSeparator /> : null}
              {onNewGroup ? (
                <DropdownMenuItem className="min-h-11" onSelect={onNewGroup}>
                  <FolderPlus />
                  New group…
                </DropdownMenuItem>
              ) : null}
              {groupId ? (
                <DropdownMenuItem className="min-h-11" onSelect={() => onMoveToGroup(null)}>
                  <FolderMinus />
                  Remove from group
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        <DropdownMenuItem className="min-h-11" onSelect={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The ⋯ on a group heading: rename, or delete the group (its chats stay). */
export function GroupItemMenu({
  name,
  onRename,
  onDelete,
  defaultOpen,
  triggerRef,
  onCloseAutoFocus,
}: {
  name: string;
  onRename: () => void;
  onDelete: () => void;
  defaultOpen?: boolean;
  triggerRef?: Ref<HTMLButtonElement>;
  onCloseAutoFocus?: () => void;
}) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger asChild>
        <IconButton ref={triggerRef} label={`Actions for group ${name}`} className={BUTTON}>
          <MoreHorizontal />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus}>
        <DropdownMenuItem className="min-h-11" onSelect={onRename}>
          <Pencil />
          Rename group
        </DropdownMenuItem>
        <DropdownMenuItem className="min-h-11" variant="destructive" onSelect={onDelete}>
          <Trash2 />
          Delete group
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
