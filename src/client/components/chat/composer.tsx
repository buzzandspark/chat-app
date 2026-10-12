"use client";
import { ArrowUp, FlaskConical, Square, X } from "lucide-react";
import { forwardRef, useCallback, useImperativeHandle, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { clearDraft, draftKey, setDraft, useDraft } from "@client/hooks/use-draft";
import { useHasHover, useIsDesktop } from "@client/hooks/use-media-query";
import { textOf } from "@client/store/chat-store";
import { useChat, useChatSettingsKnown, useChatStore, useMessage } from "@client/store/hooks";
import { useChatActions, useChatContext, type ChatSettings } from "./chat-context";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { MODELS, type ModelId } from "@shared/models";
import { MAX_MESSAGE_CHARS, type ThinkingOptions } from "@shared/types";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChunkBoundary } from "../ui/chunk-boundary";
import { chunk } from "../ui/lazy-chunk";
import { useModals } from "../ui/modal-manager";
import { IconButton } from "../ui/icon-button";
import { ExploreOptionsIsland, UNDER_INPUT_WITH_TABS } from "./explore-options";

// D21: the panel's chunk (a Radix dialog) loads on intent.
function ScenarioButton(props: Omit<ComponentProps<typeof IconButton>, "label" | "children">) {
  return (
    <IconButton label="Scenarios" tipSide="top" className="text-muted-foreground" {...props}>
      <FlaskConical />
    </IconButton>
  );
}
const loadScenarioPanel = chunk(() => import("./scenario-panel"));

// The button opens the panel itself, once the chunk is in; a chunk that fails is thrown to the boundary around it.
function ScenarioPanelOnIntent() {
  const { send } = useChatActions();
  const { show } = useModals();
  const router = useRouter();
  const [failed, setFailed] = useState<{ error: unknown } | null>(null);
  // A second press while the chunk is still on its way doesn't stack a second panel.
  const opening = useRef(false);
  if (failed) throw failed.error;
  const warm = () => {
    loadScenarioPanel().catch(() => {});
  };
  return (
    <ScenarioButton
      data-testid="scenario-panel-trigger"
      onPointerEnter={warm}
      onTouchStart={warm}
      onFocus={warm}
      onClick={() => {
        if (opening.current) return;
        opening.current = true;
        loadScenarioPanel()
          .then((m) => m.openScenarioPanel(show, send, router.push), (error: unknown) => setFailed({ error }))
          .finally(() => {
            opening.current = false;
          });
      }}
    />
  );
}

/** The picker's trigger as the stand-in: the chunk (Radix menu, sheet, switch) loads on intent. */
function PickerStandIn({
  model,
  thinking,
  known = true,
  intent,
  onPress,
}: {
  model: ModelId;
  thinking: ThinkingOptions;
  /** False until the chat's model is known: the label keeps its room but shows nothing, rather than the default. */
  known?: boolean;
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
      aria-disabled={!onPress || undefined}
      {...(intent ? intentProps(intent) : {})}
      onClick={onPress}
    >
      <span className={cn("truncate", !known && "invisible")}>{info.short}</span>
      {thinking.harder && known ? <span className="rounded-md bg-accent px-1.5 text-caption text-accent-foreground">harder</span> : null}
      <ChevronDown data-icon="inline-end" className="size-3.5" />
    </Button>
  );
}
const loadModelPicker = chunk(() => import("./model-picker").then((m) => m.ModelPicker));

function ModelPickerOnIntent({ known, ...props }: { model: ModelId; thinking: ThinkingOptions; known: boolean; onChange: (patch: Partial<ChatSettings>) => void; onPicked: () => void }) {
  const intent = useIntent(loadModelPicker);
  if (intent.failed) throw intent.failed.error;
  if (!known) return <PickerStandIn model={props.model} thinking={props.thinking} known={false} />;
  const ModelPicker = intent.loaded;
  if (intent.armed && ModelPicker) return <ModelPicker {...props} defaultOpen={intent.wanted === "picker"} />;
  return <PickerStandIn model={props.model} thinking={props.thinking} intent={intent} onPress={() => intent.press("picker")} />;
}

export interface ComposerHandle {
  focus: () => void;
  /** Replace the draft (a queued message taken back for editing). */
  setValue: (text: string) => void;
}

/** D19/D18: sticky above the keyboard, 16 px text so iOS never zooms; Enter sends only with hover + md. */
export const Composer = forwardRef<ComposerHandle, { chatId: string }>(function Composer({ chatId }, ref) {
  const { send, settings, setSettings, client, userId, editing, cancelEdit, editMessage, scenarioPanel } = useChatContext();
  const store = useChatStore();
  const chat = useChat(chatId);
  const settingsKnown = useChatSettingsKnown(chatId);
  const key = draftKey(userId, chatId);
  // The draft is empty in the server render and hydration (useDraft): read during hydration it would enable
  // Send in React while the server-rendered button stays disabled in the DOM (hydration never patches
  // attributes). D10/D18: an edit has text of its own, so the unsent draft is left as it is meanwhile.
  const draft = useDraft(key);
  const [editText, setEditText] = useState(editing?.text ?? "");
  const [editFor, setEditFor] = useState(editing);
  if (editing !== editFor) {
    setEditFor(editing);
    setEditText(editing?.text ?? "");
  }
  const value = editing ? editText : draft;
  const setValue = (text: string) => (editing ? setEditText(text) : setDraft(key, text));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const desktop = useIsDesktop();
  const hasHover = useHasHover();
  const enterSends = desktop && hasHover;

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus(), setValue: (text: string) => setDraft(key, text) }), [key]);

  // Hydrated: anything typed before hydration (the server rendered the field empty) becomes the draft, and
  // data-hydrated tells tests the composer is live. Once: the root keeps the flag when Activity re-attaches it.
  const attachRoot = useCallback(
    (root: HTMLDivElement | null) => {
      if (!root || root.dataset.hydrated) return;
      const typedEarly = root.querySelector("textarea")?.value;
      if (typedEarly) setDraft(key, typedEarly);
      root.dataset.hydrated = "true";
    },
    [key],
  );

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

  // The route refuses messages over the limit; count down near it and block the send over it.
  const overLimit = value.length > MAX_MESSAGE_CHARS;
  const nearLimit = value.length > MAX_MESSAGE_CHARS * 0.9;
  const submit = () => {
    // While a reply streams a new message is queued (the view decides); an edit has to wait for it to end.
    if (!value.trim() || overLimit || (streamingId && editing)) return;
    const wasEditing = editing !== null;
    send(value, settings.scenario?.name, editing);
    if (!wasEditing) clearDraft(key);
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
  // Haiku is reading the last reply for options: the border above the input breathes until it answers.
  const scanning = lastMessage?.optionsStream?.count === null && !lastMessage.optionsStream.failed;
  const editingText = editing ? textOf(store.getMessage(editing.userMessageId)?.blocks ?? []) : "";

  return (
    <div
      ref={attachRoot}
      data-tip-boundary
      className={cn(
        "relative order-2 shrink-0 border-t border-border bg-background safe-x pt-2 group-has-[[data-testid=fork-tabs]]/chat:border-t-0 group-has-[[data-testid=fork-tabs]]/chat:pt-0 dock:order-none dock:group-has-[[data-testid=fork-tabs]]/chat:border-t dock:group-has-[[data-testid=fork-tabs]]/chat:pt-2",
        scanning && "composer-scanning",
      )}
      data-scanning={scanning || undefined}
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.5rem)" }}
      data-testid="composer"
    >
      <div className="mx-auto flex w-full max-w-thread flex-col">
        {editing ? (
          <div className={cn("mb-2 flex items-center gap-2 text-caption text-muted-foreground", UNDER_INPUT_WITH_TABS)}>
            <span className="min-w-0 truncate rounded-md bg-accent px-2 py-1 text-accent-foreground">Editing: {editingText.slice(0, 60)}</span>
            <IconButton label="Cancel edit" size="icon-sm" onClick={cancelEdit}>
              <X />
            </IconButton>
          </div>
        ) : null}
        {scenario ? (
          <div className={cn("mb-2 flex items-center gap-2 text-caption text-muted-foreground", UNDER_INPUT_WITH_TABS)}>
            <span className="rounded-md bg-accent px-2 py-1 text-accent-foreground">Scenario: {scenario.title}</span>
            <IconButton label="Clear scenario" size="icon-sm" onClick={() => setSettings({ scenario: null })}>
              <X />
            </IconButton>
          </div>
        ) : null}
        <ExploreOptionsIsland chatId={chatId} message={lastMessage} isFork={chat.forkedFrom !== null} editing={editing !== null} />
        <div className="flex flex-col rounded-xl border border-input bg-card shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30">
          {/* Grows with its text in CSS: an invisible copy of the text in the same grid cell sets the height (up to 180 px, then it scrolls). */}
          <div
            data-value={value}
            className="grid after:invisible after:max-h-[180px] after:min-h-11 after:overflow-hidden after:px-3 after:py-2.5 after:text-body after:break-words after:whitespace-pre-wrap after:content-[attr(data-value)_'_'] after:[grid-area:1/1]"
          >
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={editing ? "Edit your message" : "Send a message"}
              aria-label="Message"
              enterKeyHint={enterSends ? "send" : "enter"}
              className="max-h-[180px] min-h-11 w-full resize-none bg-transparent px-3 py-2.5 text-body outline-none [grid-area:1/1] placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center justify-between gap-1 px-1.5 pb-1.5">
            <div className="flex min-w-0 items-center gap-0.5">
              {nearLimit ? (
                <span className={cn("px-1 text-caption tabular-nums", overLimit ? "text-destructive" : "text-muted-foreground")} role="status">
                  {value.length.toLocaleString()} / {MAX_MESSAGE_CHARS.toLocaleString()}
                </span>
              ) : null}
              <ChunkBoundary label="model picker">
                <ModelPickerOnIntent model={settings.model} thinking={settings.thinking} known={settingsKnown} onChange={(patch) => setSettings(patch)} onPicked={() => textareaRef.current?.focus()} />
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
      </div>
    </div>
  );
});
