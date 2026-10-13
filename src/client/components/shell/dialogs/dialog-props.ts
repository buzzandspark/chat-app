import type { ChatSummary } from "@client/store/sidebar-store";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export type ChatDialogProps = DialogProps & { chat: ChatSummary; currentChatId: string | null };
