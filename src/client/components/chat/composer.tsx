"use client";
import { ArrowUp, FlaskConical, Square, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { clearDraft, draftKey, readDraft, useDraft } from "@client/hooks/use-draft";
import { useHasHover, useIsDesktop } from "@client/hooks/use-media-query";
import { textOf } from "@client/store/chat-store";
import { useChat, useChatStore, useMessage } from "@client/store/hooks";
import { useChatContext, type ChatSettings } from "./chat-context";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { DEFAULT_MODEL, MODELS, type ModelId } from "@shared/models";
import dynamic from "next/dynamic";
import type { ThinkingOptions } from "@shared/types";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChunkBoundary } from "../ui/chunk-boundary";
import { IconButton } from "../ui/icon-button";

// D21: the panel's chunk (a Radix dialog) loads on intent; the stand-in is the same button.
const ScenarioPanel = dynamic(() => import("./scenario-panel").then((m) => m.ScenarioPanel), {
  ssr: false,
  loading: () => (
    <IconButton label="Scenarios" tipSide="top" disabled className="text-muted-foreground">
      <FlaskConical />
    </IconButton>
  ),
});

function ScenarioPanelOnIntent() {
  const { armed, wanted, start, press } = useIntent();
  if (armed) return <ScenarioPanel autoOpen={wanted === "panel"} />;
  return (
    <IconButton label="Scenarios" tipSide="top" className="text-muted-foreground" data-testid="scenario-panel-trigger" {...intentProps(start)} onClick={() => press("panel")}>
      <FlaskConical />
    </IconButton>
  );
}

/** The picker's trigger as the stand-in: the chunk (Radix popover, sheet, switch) loads on intent. */
function PickerStandIn({ model, thinking, start, onPress }: { model: ModelId; thinking: ThinkingOptions; start?: () => void; onPress?: () => void }) {
  const info = MODELS[model];
  return (
    <Button
      variant="ghost"
      size="sm"
      className="touch-target max-w-[55vw] gap-1 text-muted-foreground"
      aria-label="Choose model"
      aria-haspopup="listbox"
      disabled={!onPress}
      {...(start ? intentProps(start) : {})}
      onClick={onPress}
    >
      <span className="truncate">{info.short}</span>
      {thinking.harder ? <span className="rounded-md bg-accent px-1.5 text-caption text-accent-foreground">harder</span> : null}
      <ChevronDown data-icon="inline-end" className="size-3.5" />
    </Button>
  );
}
const ModelPicker = dynamic(() => import("./model-picker").then((m) => m.ModelPicker), {
  ssr: false,
  loading: () => <PickerStandIn model={DEFAULT_MODEL} thinking={{ harder: false }} />,
});

function ModelPickerOnIntent(props: { model: ModelId; thinking: ThinkingOptions; onChange: (patch: Partial<ChatSettings>) => void }) {
  const { armed, wanted, start, press } = useIntent();
  if (armed) return <ModelPicker {...props} defaultOpen={wanted === "picker"} />;
  return <PickerStandIn model={props.model} thinking={props.thinking} start={start} onPress={() => press("picker")} />;
}

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
  // Empty on both server and client: a draft read during render would enable Send in React while the
  // server-rendered button stays disabled in the DOM (hydration never patches attributes). It is
  // adopted after mount instead.
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const desktop = useIsDesktop();
  const hasHover = useHasHover();
  const enterSends = desktop && hasHover;
  // D10/D18: editing a message must not overwrite the unsent draft; it is stashed and restored.
  const [stash, setStash] = useState("");
  useDraft(key, editing ? stash : value);

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  // Adopt text typed before hydration, else the stored draft; data-hydrated tells tests the composer is live.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    const root = rootRef.current;
    const typedEarly = el && el.value !== "" && el.value !== value ? el.value : null;
    const draft = readDraft(key);
    const frame = requestAnimationFrame(() => {
      if (typedEarly !== null) setValue(typedEarly);
      else if (draft) setValue((v) => (v === "" ? draft : v));
      if (root) root.dataset.hydrated = "true";
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  // Entering edit mode loads the message text (derived state adjusted during render); leaving it,
  // by cancel or by sending the edit, brings the stashed draft back.
  const [lastEdit, setLastEdit] = useState(editing);
  if (editing !== lastEdit) {
    setLastEdit(editing);
    if (editing && !lastEdit) {
      setStash(value);
      setValue(editing.text);
    } else if (editing) {
      setValue(editing.text);
    } else if (lastEdit) {
      setValue(stash);
      setStash("");
    }
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
    const wasEditing = editing !== null;
    send(value, settings.scenario?.name);
    if (!wasEditing) {
      setValue("");
      clearDraft(key);
    }
    if (settings.scenario) setSettings({ scenario: null });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // keyCode 229: Safari delivers Enter during IME composition without isComposing.
    if (e.key === "Enter" && !e.shiftKey && enterSends && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
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

  const scenario = settings.scenario;
  const editingText = editing ? textOf(store.getMessage(editing.userMessageId)?.blocks ?? []) : "";

  return (
    <div
      ref={rootRef}
      className="shrink-0 border-t border-border bg-background safe-x pt-2"
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
              <ChunkBoundary label="model picker">
                <ModelPickerOnIntent model={settings.model} thinking={settings.thinking} onChange={(patch) => setSettings(patch)} />
              </ChunkBoundary>
              {scenarioPanel ? (
                <ChunkBoundary label="scenario panel">
                  <ScenarioPanelOnIntent />
                </ChunkBoundary>
              ) : null}
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
