"use client";
import { Trash2, Trophy } from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { getSidebarStore, type ChatSummary } from "@client/store/sidebar-store";
import { loadDialogs } from "../shell/load-dialogs";
import { useModals } from "../ui/modal-manager";


export interface ForkTabMenuProps {
  tabId: string;
  title: string;
  isMain: boolean;
  currentChatId: string;
  x: number;
  y: number;
  onClose: () => void;
}

/** A tab's right-click menu: Declare winner (a fork stays alone) or Delete forks (the main chat stays), then Delete chat; each confirms in a dialog. */
export function ForkTabMenu({ tabId, title, isMain, currentChatId, x, y, onClose }: ForkTabMenuProps) {
  const { show } = useModals();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [onClose]);
  const chat = (): ChatSummary => getSidebarStore().get().find((c) => c.id === tabId) ?? { id: tabId, title, updatedAt: 0 };
  const onDelete = () => {
    onClose();
    const c = chat();
    loadDialogs().then(({ DeleteDialog }) => show(({ open, close }) => <DeleteDialog chat={c} currentChatId={currentChatId} open={open} onOpenChange={(o) => !o && close()} />), () => {});
  };
  const onDeclareWinner = () => {
    onClose();
    const c = chat();
    loadDialogs().then(
      ({ DeclareWinnerDialog }) => show(({ open, close }) => <DeclareWinnerDialog chat={c} currentChatId={currentChatId} open={open} onOpenChange={(o) => !o && close()} />),
      () => {},
    );
  };
  const onDeleteForks = () => {
    onClose();
    const c = chat();
    loadDialogs().then(
      ({ DeleteForksDialog }) => show(({ open, close }) => <DeleteForksDialog chat={c} currentChatId={currentChatId} open={open} onOpenChange={(o) => !o && close()} />),
      () => {},
    );
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
    }
  };
  const left = Math.min(x, (typeof window === "undefined" ? x : window.innerWidth) - 200);
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Tab actions for ${title}`}
      className="fixed z-50 min-w-44 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      // Opens toward the room: down from the docked strip at the top, up from the phone's tabs on the composer.
      style={y < window.innerHeight / 2 ? { left, top: y } : { left, bottom: window.innerHeight - y }}
      onKeyDown={onKeyDown}
    >
      <button type="button" role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-small hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={isMain ? onDeleteForks : onDeclareWinner}>
        <Trophy className={isMain ? "size-4" : "size-4 text-warning"} />
        {isMain ? "Delete forks" : "Declare winner"}
      </button>
      <button type="button" role="menuitem" className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-small text-destructive hover:bg-muted focus-visible:bg-muted focus-visible:outline-none" onClick={onDelete}>
        <Trash2 className="size-4" />
        Delete chat
      </button>
    </div>
  );
}
