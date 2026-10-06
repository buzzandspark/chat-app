"use client";
import { ArrowUp, Square, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { clearDraft, draftKey, readDraft, useDraft } from "@client/hooks/use-draft";
import { useHasHover, useIsDesktop } from "@client/hooks/use-media-query";
import { getChatStore, textOf } from "@client/store/chat-store";
import { useChat, useMessage } from "@client/store/hooks";
import { SCENARIOS, isScenarioName } from "@relay/scenario-catalog";
import { useChatContext } from "./chat-context";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";

// D21: the picker's sheet/popover (Radix) loads after first paint.
const ModelPicker = dynamic(() => import("./model-picker").then((m) => m.ModelPicker), {
  ssr: false,
  loading: () => (
    <Button variant="ghost" size="sm" className="touch-target gap-1 text-muted-foreground" disabled aria-label="Choose model">
      <span className="truncate">Sonnet 5.5</span>
      <ChevronDown data-icon="inline-end" className="size-3.5" />
    </Button>
  ),
});

export interface ComposerHandle {
  focus: () => void;
}

const MAX_ROWS_PX = 180;

/**
 * Phone base: sticky at the bottom, follows the keyboard through the
 * `--keyboard-inset` variable (D19), 16 px text so iOS never zooms, 44 px
 * targets. Enter sends only where a hardware keyboard is likely (hover +
 * md); on phones Enter is a newline and the arrow button sends. Drafts are
 * kept per (user, chat) in localStorage (D18).
 */
export const Composer = forwardRef<ComposerHandle, { chatId: string }>(function Composer({ chatId }, ref) {
  const { send, settings, setSettings, client, userId, editing, cancelEdit, editMessage } = useChatContext();
  const chat = useChat(chatId);
  const key = draftKey(userId, chatId);
  const [value, setValue] = useState(() => (typeof window === "undefined" ? "" : readDraft(key)));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const desktop = useIsDesktop();
  const hasHover = useHasHover();
  const enterSends = desktop && hasHover;
  useDraft(key, editing ? "" : value);

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  // Progressive enhancement: text typed into the server-rendered textarea
  // before hydration is adopted rather than discarded, and the root carries a
  // marker so tests know when the composer is live.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    const root = rootRef.current;
    const typedEarly = el && el.value !== "" && el.value !== value ? el.value : null;
    const frame = requestAnimationFrame(() => {
      if (typedEarly !== null) setValue(typedEarly);
      if (root) root.dataset.hydrated = "true";
    });
    return () => cancelAnimationFrame(frame);
    // Mount only: later value changes are React's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Entering edit mode loads the message text (derived state adjusted during render).
  const [lastEdit, setLastEdit] = useState(editing);
  if (editing !== lastEdit) {
    setLastEdit(editing);
    if (editing) setValue(editing.text);
    else if (lastEdit) setValue("");
  }

  // Subscribe to the last message itself: its status decides Stop vs Send and
  // whether ↑ may edit (the id list alone does not change when a reply ends).
  const lastMessage = useMessage(chat.messageIds[chat.messageIds.length - 1] ?? "");
  const streamingId = lastMessage?.role === "assistant" && lastMessage.status === "streaming" ? lastMessage.generationId : null;
  const lastUserId = (() => {
    for (let i = chat.messageIds.length - 1; i >= 0; i--) {
      const m = getChatStore().getMessage(chat.messageIds[i]!);
      if (m?.role === "user") return m.id;
    }
    return null;
  })();

  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(MAX_ROWS_PX, el.scrollHeight)}px`;
  }, []);

  useEffect(() => resize(), [value, resize]);

  const submit = () => {
    if (!value.trim()) return;
    send(value, settings.scenario ?? undefined);
    setValue("");
    clearDraft(key);
    if (settings.scenario) setSettings({ scenario: null });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && enterSends && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      // D19: Esc closes an open dialog or menu first (they handle it); here it cancels an edit, then stops.
      if (editing) {
        e.preventDefault();
        cancelEdit();
      } else if (streamingId) {
        e.preventDefault();
        void client.stop(streamingId);
      }
    } else if (e.key === "ArrowUp" && value === "" && lastUserId && !streamingId && !editing) {
      e.preventDefault();
      editMessage(lastUserId);
    }
  };

  const scenario = settings.scenario && isScenarioName(settings.scenario) ? SCENARIOS[settings.scenario] : null;
  const editingText = editing ? textOf(getChatStore().getMessage(editing.userMessageId)?.blocks ?? []) : "";

  return (
    <div
      ref={rootRef}
      className="shrink-0 border-t border-border bg-background px-gutter pt-2"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.5rem)" }}
      data-testid="composer"
    >
      <div className="mx-auto w-full max-w-thread">
        {editing ? (
          <div className="mb-2 flex items-center gap-2 text-caption text-muted-foreground">
            <span className="min-w-0 truncate rounded-md bg-accent px-2 py-1 text-accent-foreground">Editing: {editingText.slice(0, 60)}</span>
            <button type="button" className="touch-target inline-flex items-center justify-center" aria-label="Cancel edit" onClick={cancelEdit}>
              <X className="size-4" />
            </button>
          </div>
        ) : null}
        {scenario ? (
          <div className="mb-2 flex items-center gap-2 text-caption text-muted-foreground">
            <span className="rounded-md bg-accent px-2 py-1 text-accent-foreground">Scenario: {scenario.title}</span>
            <button type="button" className="touch-target inline-flex items-center justify-center" aria-label="Clear scenario" onClick={() => setSettings({ scenario: null })}>
              <X className="size-4" />
            </button>
          </div>
        ) : null}
        <div className="flex flex-col rounded-xl border border-input bg-card shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder={editing ? "Edit your message" : "Message Cadence"}
            aria-label="Message"
            enterKeyHint={enterSends ? "send" : "enter"}
            className="max-h-[180px] min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-body outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between gap-1 px-1.5 pb-1.5">
            <ModelPicker model={settings.model} thinking={settings.thinking} onChange={(patch) => setSettings(patch)} />
            {streamingId ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                className="touch-target rounded-full"
                aria-label="Stop generating"
                onClick={() => void client.stop(streamingId)}
              >
                <Square className="fill-current" />
              </Button>
            ) : (
              <Button
                type="button"
                size="icon"
                className={cn("touch-target rounded-full", !value.trim() && "opacity-40")}
                aria-label={editing ? "Send edited message" : "Send message"}
                disabled={!value.trim()}
                onClick={submit}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
        {enterSends ? (
          <p className="mt-1 hidden text-caption text-muted-foreground md:block">
            Enter to send · Shift+Enter for a new line · ↑ edits your last message · Esc stops · ⌘K search · ⌘⇧O new chat
          </p>
        ) : null}
      </div>
    </div>
  );
});
