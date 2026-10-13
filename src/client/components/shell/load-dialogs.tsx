"use client";
import type { ComponentType } from "react";
import type { ChatSummary } from "@client/store/sidebar-store";
import { chunk } from "../ui/lazy-chunk";
import type { ModalRender } from "../ui/modal-manager";
import type { ChatDialogProps } from "./chat-dialogs";

/** Every dialog is in this one chunk, fetched in idle time after the page loads, so the first open waits for nothing. */
export const loadDialogs = chunk(() => import("./dialogs"));

/** Shows one of the chunk's chat dialogs, once the chunk is in. */
export function openDialog(
  show: (render: ModalRender) => unknown,
  name: "RenameDialog" | "DeleteDialog" | "DeleteAllDialog" | "DeclareWinnerDialog" | "DeleteForksDialog",
  chat: ChatSummary,
  currentChatId: string | null,
) {
  loadDialogs().then((dialogs) => {
    const Dialog: ComponentType<ChatDialogProps> = dialogs[name];
    show(({ open, close }) => <Dialog chat={chat} currentChatId={currentChatId} open={open} onOpenChange={(o) => !o && close()} />);
  }, () => {});
}

if (typeof window !== "undefined") {
  const preload = () => void loadDialogs().catch(() => {});
  if ("requestIdleCallback" in window) window.requestIdleCallback(preload, { timeout: 5000 });
  else setTimeout(preload, 2000);
}
