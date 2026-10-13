"use client";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@client/hooks/use-media-query";
import { intentProps, useIntent } from "@client/hooks/use-lazy-on-intent";
import { chunk } from "@client/components/ui/lazy-chunk";
import { EFFORT_LABELS, MODELS, type ModelId } from "@shared/models";
import type { ThinkingOptions } from "@shared/types";
import type { ChatSettings } from "../chat-context";

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
  const effort = thinking.effort === "low" ? null : EFFORT_LABELS[thinking.effort];
  // Announce what the loaded trigger will open: the menu at `md`, the sheet (a dialog) on phones.
  const desktop = useIsDesktop();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="touch-target max-w-[55vw] gap-1 text-muted-foreground"
      aria-label={known ? `Model: ${info.short}${effort ? `, effort ${effort}` : ""}` : "Model"}
      aria-haspopup={desktop ? "menu" : "dialog"}
      aria-disabled={!onPress || undefined}
      {...(intent ? intentProps(intent) : {})}
      onClick={onPress}
    >
      <span className={cn("truncate", !known && "invisible")}>{info.short}</span>
      {effort && known ? <span className="shrink-0 rounded-md bg-accent px-1.5 text-caption text-accent-foreground">{effort}</span> : null}
      <ChevronDown data-icon="inline-end" className="size-3.5" />
    </Button>
  );
}
const loadModelPicker = chunk(() => import("./model-picker").then((m) => m.ModelPicker));

export function ModelPickerOnIntent({ known, ...props }: { model: ModelId; thinking: ThinkingOptions; known: boolean; onChange: (patch: Partial<ChatSettings>) => void; onPicked: () => void; guest: boolean }) {
  const intent = useIntent(loadModelPicker);
  if (intent.failed) throw intent.failed.error;
  if (!known) return <PickerStandIn model={props.model} thinking={props.thinking} known={false} />;
  const ModelPicker = intent.loaded;
  if (intent.armed && ModelPicker) return <ModelPicker {...props} defaultOpen={intent.wanted === "picker"} />;
  return <PickerStandIn model={props.model} thinking={props.thinking} intent={intent} onPress={() => intent.press("picker")} />;
}
