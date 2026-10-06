"use client";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useIsDesktop } from "@client/hooks/use-media-query";
import { MODEL_IDS, MODELS, type ModelId } from "@shared/models";
import type { ThinkingOptions } from "@shared/types";

interface ModelPickerProps {
  model: ModelId;
  thinking: ThinkingOptions;
  onChange: (patch: { model?: ModelId; thinking?: ThinkingOptions }) => void;
}

/** One picker (D0): a bottom sheet on phones, a popover at `md`. */
export function ModelPicker({ model, thinking, onChange }: ModelPickerProps) {
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const info = MODELS[model];
  const thinkingLabel = info.thinking === "adaptive" ? "Think harder" : "Extended thinking";

  const trigger = (
    <Button variant="ghost" size="sm" className="touch-target max-w-[55vw] gap-1 text-muted-foreground" aria-label="Choose model">
      <span className="truncate">{info.short}</span>
      {thinking.harder ? <span className="rounded-md bg-accent px-1.5 text-caption text-accent-foreground">harder</span> : null}
      <ChevronDown data-icon="inline-end" className="size-3.5" />
    </Button>
  );

  const body = (
    <div className="flex flex-col gap-1 py-1">
      {MODEL_IDS.map((id) => {
        const m = MODELS[id];
        const selected = id === model;
        return (
          <button
            key={id}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => {
              onChange({ model: id });
              setOpen(false);
            }}
            className={cn(
              "flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 text-left",
              selected ? "bg-accent text-accent-foreground" : "hover:bg-muted active:bg-muted",
            )}
          >
            <span className="flex flex-col">
              <span className="text-body font-medium">{m.name}</span>
              <span className="text-caption text-muted-foreground">{m.blurb}</span>
            </span>
            {selected ? <Check className="size-4 shrink-0" /> : null}
          </button>
        );
      })}
      <label className="mt-1 flex min-h-12 items-center justify-between gap-3 rounded-lg px-3">
        <span className="flex flex-col">
          <span className="text-body font-medium">{thinkingLabel}</span>
          <span className="text-caption text-muted-foreground">
            {info.thinking === "adaptive" ? "Effort high instead of low" : "A 2,048-token thinking budget"}
          </span>
        </span>
        <Switch checked={thinking.harder} onCheckedChange={(harder) => onChange({ thinking: { harder } })} aria-label={thinkingLabel} />
      </label>
    </div>
  );

  if (desktop) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-1" role="listbox" aria-label="Models">
          {body}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-sheet px-gutter pb-[max(env(safe-area-inset-bottom,0px),1rem)]">
        <SheetHeader className="px-0">
          <SheetTitle>Model</SheetTitle>
        </SheetHeader>
        <div role="listbox" aria-label="Models">
          {body}
        </div>
      </SheetContent>
    </Sheet>
  );
}
