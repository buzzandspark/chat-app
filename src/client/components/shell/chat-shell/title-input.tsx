"use client";
import { useRef, useState } from "react";
import { useChatStore } from "@client/store/context";
import { getSidebarStore, patchChat } from "@client/store/sidebar-store";

/**
 * The header title as an input: Enter or leaving it saves, Escape cancels. The new title shows at once;
 * a refused or failed save puts the old one back, unless the title has changed again since.
 */
export function TitleInput({ chatId, title, onClose, onFailed }: { chatId: string; title: string; onClose: () => void; onFailed: () => void }) {
  const store = useChatStore();
  const [value, setValue] = useState(title);
  const settled = useRef(false);
  const save = async () => {
    if (settled.current) return;
    settled.current = true;
    onClose();
    const next = value.trim();
    if (!next || next === title) return;
    const sidebar = getSidebarStore();
    sidebar.patch(chatId, { title: next });
    store.setChatTitle(chatId, next);
    if (await patchChat(chatId, { title: next })) return;
    if (sidebar.get().find((c) => c.id === chatId)?.title !== next) return;
    sidebar.patch(chatId, { title });
    store.setChatTitle(chatId, title);
    onFailed();
  };
  return (
    <input
      // Focused and selected as it mounts, in place of the title it replaces.
      ref={(el) => {
        el?.focus();
        el?.select();
      }}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void save()}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") {
          e.preventDefault();
          settled.current = true;
          onClose();
        }
      }}
      aria-label="Chat title"
      maxLength={120}
      enterKeyHint="done"
      // 16 px where a touch keyboard is likely, so iOS doesn't zoom; the title's own size with a mouse.
      className="min-h-11 min-w-0 flex-1 rounded-md border border-input bg-transparent px-[calc(0.5rem-1px)] text-body font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [@media(hover:hover)]:text-small"
    />
  );
}
