"use client";
import { ArrowUp, Square, X } from "lucide-react";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHasHover, useIsDesktop } from "@client/hooks/use-media-query";
import { getChatStore } from "@client/store/chat-store";
import { useChat } from "@client/store/hooks";
import { SCENARIOS, isScenarioName } from "@relay/scenarios";
import { useChatContext } from "./chat-context";
import { ModelPicker } from "./model-picker";

export interface ComposerHandle {
  focus: () => void;
}

const MAX_ROWS_PX = 180;

/**
 * Phone base: sticky at the bottom, follows the keyboard through the
 * `--keyboard-inset` variable (D19), 16 px text so iOS never zooms, 44 px
 * targets. Enter sends only where a hardware keyboard is likely (hover +
 * md); on phones Enter is a newline and the arrow button sends.
 */
export const Composer = forwardRef<ComposerHandle, { chatId: string }>(function Composer({ chatId }, ref) {
  const { send, settings, setSettings, client } = useChatContext();
  const chat = useChat(chatId);
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const desktop = useIsDesktop();
  const hasHover = useHasHover();
  const enterSends = desktop && hasHover;

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  const streamingId = (() => {
    for (let i = chat.messageIds.length - 1; i >= 0; i--) {
      const m = getChatStore().getMessage(chat.messageIds[i]!);
      if (m?.role === "assistant") return m.status === "streaming" ? m.generationId : null;
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
    if (settings.scenario) setSettings({ scenario: null });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && enterSends && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape" && streamingId) {
      e.preventDefault();
      void client.stop(streamingId);
    }
  };

  const scenario = settings.scenario && isScenarioName(settings.scenario) ? SCENARIOS[settings.scenario] : null;

  return (
    <div
      className="shrink-0 border-t border-border bg-background px-gutter pt-2"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.5rem)" }}
      data-testid="composer"
    >
      <div className="mx-auto w-full max-w-thread">
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
            placeholder="Message Cadence"
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
                aria-label="Send message"
                disabled={!value.trim()}
                onClick={submit}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
        {enterSends ? (
          <p className="mt-1 hidden text-caption text-muted-foreground md:block">Enter to send · Shift+Enter for a new line · Esc to stop</p>
        ) : null}
      </div>
    </div>
  );
});
