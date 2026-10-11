"use client";
import { ArrowUp, FlaskConical, Square, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { clearDraft, draftKey, readDraft, useDraft } from "@client/hooks/use-draft";
import { useHasHover, useIsDesktop } from "@client/hooks/use-media-query";
import { textOf } from "@client/store/chat-store";
import { useChat, useChatStore, useMessage } from "@client/store/hooks";
import { useChatContext, type ChatSettings } from "./chat-context";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { DEFAULT_MODEL, MODELS, type ModelId } from "@shared/models";
import dynamic from "next/dynamic";
import { MAX_MESSAGE_CHARS, type ThinkingOptions } from "@shared/types";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChunkBoundary } from "../ui/chunk-boundary";
import { lazyChunk } from "../ui/lazy-chunk";
import { IconButton } from "../ui/icon-button";
import { ExploreOptionsIsland } from "./explore-options";

// D21: the panel's chunk (a Radix dialog) loads on intent; the stand-in is the same button.
function ScenarioButton(props: Omit<ComponentProps<typeof IconButton>, "label" | "children">) {
  return (
    <IconButton label="Scenarios" tipSide="top" className="text-muted-foreground" {...props}>
      <FlaskConical />
    </IconButton>
  );
}
const ScenarioPanel = lazyChunk(() =>
  dynamic(() => import("./scenario-panel").then((m) => m.ScenarioPanel), {
    ssr: false,
    loading: () => <ScenarioButton disabled />,
  }),
);

const warmScenarioPanel = () => import("./scenario-panel");

function ScenarioPanelOnIntent() {
  const intent = useIntent(warmScenarioPanel);
  if (intent.armed) return <ScenarioPanel autoOpen={intent.wanted === "panel"} />;
  return <ScenarioButton data-testid="scenario-panel-trigger" {...intentProps(intent)} onClick={() => intent.press("panel")} />;
}

/** The picker's trigger as the stand-in: the chunk (Radix menu, sheet, switch) loads on intent. */
function PickerStandIn({
  model,
  thinking,
  intent,
  onPress,
}: {
  model: ModelId;
  thinking: ThinkingOptions;
  intent?: { warmUp: () => void };
  onPress?: () => void;
}) {
  const info = MODELS[model];
  // Announce what the loaded trigger will open: the menu at `md`, the sheet (a dialog) on phones.
  const desktop = useIsDesktop();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="touch-target max-w-[55vw] gap-1 text-muted-foreground"
      aria-label="Choose model"
      aria-haspopup={desktop ? "menu" : "dialog"}
      disabled={!onPress}
      {...(intent ? intentProps(intent) : {})}
      onClick={onPress}
    >
      <span className="truncate">{info.short}</span>
      {thinking.harder ? <span className="rounded-md bg-accent px-1.5 text-caption text-accent-foreground">harder</span> : null}
      <ChevronDown data-icon="inline-end" className="size-3.5" />
    </Button>
  );
}
const ModelPicker = lazyChunk(() =>
  dynamic(() => import("./model-picker").then((m) => m.ModelPicker), {
    ssr: false,
    loading: () => <PickerStandIn model={DEFAULT_MODEL} thinking={{ harder: false }} />,
  }),
);

const warmModelPicker = () => import("./model-picker");

function ModelPickerOnIntent(props: { model: ModelId; thinking: ThinkingOptions; onChange: (patch: Partial<ChatSettings>) => void }) {
  const intent = useIntent(warmModelPicker);
  if (intent.armed) return <ModelPicker {...props} defaultOpen={intent.wanted === "picker"} />;
  return <PickerStandIn model={props.model} thinking={props.thinking} intent={intent} onPress={() => intent.press("picker")} />;
}

export interface ComposerHandle {
  focus: () => void;
  /** Replace the draft (a queued message taken back for editing). */
  setValue: (text: string) => void;
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
  const [adopted, setAdopted] = useState(false);
  useDraft(key, editing ? stash : value, adopted);

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus(), setValue: (text: string) => setValue(text) }), []);

  // Adopt text typed before hydration, else the stored draft; data-hydrated tells tests the composer is live.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = textareaRef.current;
    const root = rootRef.current;
    // The state starts empty, so anything in the element was typed before hydration.
    const typedEarly = el && el.value !== "" ? el.value : null;
    const draft = readDraft(key);
    const frame = requestAnimationFrame(() => {
      if (typedEarly !== null) setValue((v) => (v === "" ? typedEarly : v));
      else if (draft) setValue((v) => (v === "" ? draft : v));
      setAdopted(true);
      if (root) root.dataset.hydrated = "true";
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);

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
  // Stop shows a pending state until the stream actually ends (or the request fails) (#68).
  // client.stop never rejects: a refusal, a network error or a timeout all settle false, which
  // re-enables Stop and Esc so the user can try again; only that same stop's pending state clears.
  const [stopping, setStopping] = useState<string | null>(null);
  const stop = (id: string) => {
    if (stopping === id) return;
    setStopping(id);
    void client.stop(id).then((ok) => {
      if (!ok) setStopping((s) => (s === id ? null : s));
    });
  };
  if (stopping !== null && stopping !== streamingId) setStopping(null);
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

  // The route refuses messages over the limit; count down near it and block the send over it.
  const overLimit = value.length > MAX_MESSAGE_CHARS;
  const nearLimit = value.length > MAX_MESSAGE_CHARS * 0.9;
  const submit = () => {
    // While a reply streams a new message is queued (the view decides); an edit has to wait for it to end.
    if (!value.trim() || overLimit || (streamingId && editing)) return;
    const wasEditing = editing !== null;
    send(value, settings.scenario?.name, editing);
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
        stop(streamingId);
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
      data-tip-boundary
      className="relative shrink-0 border-t border-border bg-background safe-x pt-2"
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
        <ExploreOptionsIsland chatId={chatId} message={lastMessage} isFork={chat.forkedFrom !== null} editing={editing !== null} />
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
              {nearLimit ? (
                <span className={cn("px-1 text-caption tabular-nums", overLimit ? "text-destructive" : "text-muted-foreground")} role="status">
                  {value.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}
                </span>
              ) : null}
              <ChunkBoundary label="model picker">
                <ModelPickerOnIntent model={settings.model} thinking={settings.thinking} onChange={(patch) => setSettings(patch)} />
              </ChunkBoundary>
              {scenarioPanel ? (
                <ChunkBoundary label="scenario panel">
                  <ScenarioPanelOnIntent />
                </ChunkBoundary>
              ) : null}
            </div>
            <div className="flex items-center gap-1">
              {streamingId ? (
                <IconButton
                  label={stopping === streamingId ? "Stopping" : "Stop generating"}
                  tipSide="top"
                  variant="secondary"
                  className="rounded-full"
                  aria-busy={stopping === streamingId}
                  disabled={stopping === streamingId}
                  onClick={() => stop(streamingId)}
                >
                  <Square className={cn("fill-current", stopping === streamingId && "animate-pulse")} />
                </IconButton>
              ) : null}
              {/* While a reply streams this queues the message; an edit cannot be queued, so it waits. */}
              {streamingId && editing ? null : (
                <IconButton
                  label={streamingId ? "Queue message" : editing ? "Send edited message" : "Send message"}
                  tipSide="top"
                  variant="default"
                  className={cn("rounded-full", (!value.trim() || overLimit) && "bg-muted text-muted-foreground disabled:opacity-100")}
                  disabled={!value.trim() || overLimit}
                  onClick={submit}
                >
                  <ArrowUp />
                </IconButton>
              )}
            </div>
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
