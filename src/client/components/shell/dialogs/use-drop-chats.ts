"use client";
import { useRouter } from "next/navigation";
import { markNavigationClose } from "@client/hooks/use-back-gesture";
import { useNewChat } from "@client/hooks/use-new-chat";
import { useChatStore } from "@client/store/hooks";
import { getSidebarStore, setPendingChat } from "@client/store/sidebar-store";

/** Removes the chats from the sidebar and the store; when the open chat was one, opens `fallback` (a new chat when null). */
export function useDropChats(onOpenChange: (open: boolean) => void) {
  const store = useChatStore();
  const router = useRouter();
  const newChat = useNewChat();
  return (ids: string[], currentChatId: string | null, fallback: string | null) => {
    const sidebar = getSidebarStore();
    for (const id of ids) {
      sidebar.remove(id);
      // The hidden view (and a Back to its URL) shows an empty chat, not the deleted rows.
      store.removeChat(id);
    }
    const leaving = currentChatId !== null && ids.includes(currentChatId);
    if (leaving) markNavigationClose();
    onOpenChange(false);
    if (!leaving) return;
    if (fallback) {
      setPendingChat(fallback);
      router.push(`/c/${fallback}`);
    } else newChat();
  };
}
