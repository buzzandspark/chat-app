"use client";
import { ArrowUp, FlaskConical, Square, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { clearDraft, draftKey, readDraft, useDraft } from "@client/hooks/use-draft";
import { useHasHover, useIsDesktop } from "@client/hooks/use-media-query";
import { textOf } from "@client/store/chat-store";
import { useChat, useChatStore, useMessage } from "@client/store/hooks";
import { SCENARIOS, isScenarioName } from "@relay/scenario-catalog";
import { useChatContext } from "./chat-context";
import dynamic from "next/dynamic";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "../ui/icon-button";

// D21: the picker's sheet/popover (Radix) loads after first paint.
const ScenarioPanel = dynamic(() => import("./scenario-panel").then((m) => m.ScenarioPanel), {
  ssr: false,
  loading: () => (
    <IconButton label="Scenarios" tipSide="top" disabled className="text-muted-foreground">
      <FlaskConical />
    </IconButton>
  ),
});

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

/** D19/D18: sticky above the keyboard, 16 px text so iOS never zooms; Enter sends only with hover + md. */
export const Composer = forwardRef<ComposerHandle, { chatId: string }>(function Composer({ chatId }, ref) {
  const { send, settings, setSettings, client, userId, editing, cancelEdit, editMessage, scenarioPanel } = useChatContext();
  const store = useChatStore();
  const chat = useChat(chatId);
  const key = draftKey(userId, chatId);
  const [value, setValue] = useState(() => (typeof window === "undefined" ? "" : readDraft(key)));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const desktop = useIsDesktop();
  const hasHover = useHasHover();
  const enterSends = desktop && hasHover;
  useDraft(key, editing ? "" : value);

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  // Adopt text typed before hydration; data-hydrated tells tests the composer is live.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Entering edit mode loads the message text (derived state adjusted during render).
  const [lastEdit, setLastEdit] = useState(editing);
  if (editing !== lastEdit) {
    setLastEdit(editing);
    if (editing) setValue(editing.text);
    else if (lastEdit) setValue("");
  }

  // The id list does not change when a reply ends; the last message's status decides Stop/Send and ↑.
  const lastMessage = useMessage(chat.messageIds[chat.messageIds.length - 1] ?? "");
  const streamingId = lastMessage?.role === "assistant" && lastMessage.status === "streaming" ? lastMessage.generationId : null;
  const lastUserId = (() => {
    for (let i = chat.messageIds.length - 1; i >= 0; i--) {
      const m = store.getMessage(chat.messageIds[i]!);
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
    // One generation at a time: while a reply streams, Enter and the button do nothing.
    if (!value.trim() || streamingId) return;
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
      // D19: open dialogs and menus handle Esc themselves; here it cancels an edit, else stops.
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
  const editingText = editing ? textOf(store.getMessage(editing.userMessageId)?.blocks ?? []) : "";

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
            <IconButton label="Cancel edit" size="icon-sm" onClick={cancelEdit}>
              <X />
            </IconButton>
          </div>
        ) : null}
        {scenario ? (
          <div className="mb-2 flex items-center gap-2 text-caption text-muted-foreground">
            <span className="rounded-md bg-accent px-2 py-1 text-accent-foreground">Scenario: {scenario.title}</span>
            <IconButton label="Clear scenario" size="icon-sm" onClick={() => setSettings({ scenario: null })}>
              <X />
            </IconButton>
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
            <div className="flex min-w-0 items-center gap-0.5">
              <ModelPicker model={settings.model} thinking={settings.thinking} onChange={(patch) => setSettings(patch)} />
              {scenarioPanel ? <ScenarioPanel /> : null}
            </div>
            {streamingId ? (
              <IconButton
                label="Stop generating"
                tipSide="top"
                tipAlign="end"
                variant="secondary"
                className="rounded-full"
                onClick={() => void client.stop(streamingId)}
              >
                <Square className="fill-current" />
              </IconButton>
            ) : (
              <IconButton
                label={editing ? "Send edited message" : "Send message"}
                tipSide="top"
                tipAlign="end"
                variant="default"
                className={cn("rounded-full", !value.trim() && "bg-muted text-muted-foreground disabled:opacity-100")}
                disabled={!value.trim()}
                onClick={submit}
              >
                <ArrowUp />
              </IconButton>
            )}
          </div>
        </div>
        {/* Shown by CSS where a hardware keyboard is likely (md + hover), so the server, the skeleton and the client agree on the height. */}
        <p className="mt-1 hidden text-caption text-muted-foreground md:[@media(hover:hover)]:block">
          Enter to send · Shift+Enter for a new line · ↑ edits your last message · Esc stops · ⌘K search · ⌘⇧O new chat
        </p>
      </div>
    </div>
  );
});
