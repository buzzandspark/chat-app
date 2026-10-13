"use client";
import { Check, ChevronDown } from "lucide-react";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useBackGesture } from "@client/hooks/use-back-gesture";
import { useIsDesktop } from "@client/hooks/use-media-query";
import { EFFORT_LABELS, EFFORTS, MODEL_IDS, MODELS, type Effort, type ModelId, GUEST_MODEL } from "@shared/models";
import type { ThinkingOptions } from "@shared/types";

// Shown only in the picker, so the main chunk carries names, not copy.
const MODEL_BLURBS: Record<ModelId, string> = {
  "claude-sonnet-5-5": "Fast and capable for everyday work",
  "claude-opus-5-5": "Deepest reasoning for hard problems",
  "claude-haiku-5-5": "Fastest replies at the lowest cost",
};

const EFFORT_BLURBS: Record<Effort, string> = {
  low: "Quick replies, least thinking",
  medium: "Balanced",
  high: "Thinks longer before replying",
  xhigh: "Deep thinking for hard tasks",
  max: "Thinks as long as it needs",
};

// Menu items are divs, so cursor-pointer/select-none give them the feel of the buttons the sheet uses.
const ROW = "flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50";
// A model a guest can't use: greyed out and inert (Radix marks a disabled item data-disabled).
const LOCKED = "data-disabled:cursor-not-allowed data-disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50";
const rowTone = (selected: boolean) => (selected ? "bg-accent text-accent-foreground" : "hover:bg-muted active:bg-muted");
const GROUP_LABEL = "mt-1 px-3 pt-1 text-caption font-medium text-muted-foreground";

function RowText({ title, blurb }: { title: string; blurb: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-body font-medium">{title}</span>
      <span className="text-caption text-muted-foreground">{blurb}</span>
    </span>
  );
}

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/** Each of the sheet's radio groups is one tab stop; arrows (and Home/End) move between its rows. Picking a model
 *  closes the sheet, so unlike a form's radio group the arrows move focus only and Space/Enter picks. */
function onRadioKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
  const group = e.currentTarget.closest('[role="radiogroup"]');
  if (!group) return;
  const radios = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]:not(:disabled)'));
  const at = radios.indexOf(e.currentTarget);
  const step = STEPS[e.key];
  const next = step !== undefined ? radios[(at + step + radios.length) % radios.length] : e.key === "Home" ? radios[0] : e.key === "End" ? radios.at(-1) : undefined;
  if (!next) return;
  e.preventDefault();
  next.focus();
}

interface ModelPickerProps {
  model: ModelId;
  thinking: ThinkingOptions;
  onChange: (patch: { model?: ModelId; thinking?: ThinkingOptions }) => void;
  /** True when the user pressed the stand-in before this chunk had loaded. */
  defaultOpen?: boolean;
  /** Called instead of returning focus to the trigger when the menu closes because a model was picked. */
  onPicked?: () => void;
  /** A guest: only Haiku can be picked; the other models show greyed out, with a note to sign in. */
  guest?: boolean;
}

/** A bottom sheet on phones, a menu at `md`. */
export function ModelPicker({ model, thinking, onChange, defaultOpen = false, onPicked, guest = false }: ModelPickerProps) {
  const locked = (id: ModelId) => guest && id !== GUEST_MODEL;
  const blurb = (id: ModelId) => (locked(id) ? "Sign in to use this model" : MODEL_BLURBS[id]);
  const desktop = useIsDesktop();
  const [open, setOpen] = useState(defaultOpen);
  const picked = useRef(false);
  useBackGesture(open && !desktop, () => setOpen(false));
  const effortLabelId = useId();
  const info = MODELS[model];
  const effort = thinking.effort === "low" ? null : EFFORT_LABELS[thinking.effort].toLowerCase();

  const trigger = (
    <Button variant="ghost" size="sm" className="touch-target max-w-[55vw] gap-1 text-muted-foreground" aria-label={`Model: ${info.short}${effort ? `, effort ${effort}` : ""}`}>
      <span className="truncate">{info.short}</span>
      {effort ? <span className="shrink-0 rounded-md bg-accent px-1.5 text-caption text-accent-foreground">{effort}</span> : null}
      <ChevronDown data-icon="inline-end" className="size-3.5" />
    </Button>
  );

  if (desktop) {
    // A Radix menu, not a popover of buttons: a popover portalled to the end of <body> put the options out of
    // keyboard reach (Tab skipped past them). The menu takes focus; arrows walk the rows and Enter/Space picks.
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="flex w-80 flex-col gap-1 px-1 py-2 outline-none"
          // A picked model sends focus on to the input, ready to type; Escape or a click away returns it to the trigger.
          onCloseAutoFocus={(e) => {
            if (!picked.current || !onPicked) return;
            picked.current = false;
            e.preventDefault();
            onPicked();
          }}
        >
          <MenuPrimitive.RadioGroup value={model} className="flex flex-col gap-1">
            {MODEL_IDS.map((id) => (
              <MenuPrimitive.RadioItem
                key={id}
                value={id}
                disabled={locked(id)}
                onSelect={() => {
                  picked.current = true;
                  onChange({ model: id });
                }}
                className={cn(ROW, rowTone(id === model), LOCKED)}
              >
                <RowText title={MODELS[id].name} blurb={blurb(id)} />
                {id === model ? <Check className="size-4 shrink-0" /> : null}
              </MenuPrimitive.RadioItem>
            ))}
          </MenuPrimitive.RadioGroup>
          <MenuPrimitive.Label id={effortLabelId} className={GROUP_LABEL}>
            Effort
          </MenuPrimitive.Label>
          <MenuPrimitive.RadioGroup value={thinking.effort} aria-labelledby={effortLabelId} className="flex flex-col gap-1">
            {EFFORTS.map((e) => (
              <MenuPrimitive.RadioItem
                key={e}
                value={e}
                onSelect={(event) => {
                  // Picking an effort keeps the menu open.
                  event.preventDefault();
                  onChange({ thinking: { effort: e } });
                }}
                className={cn(ROW, rowTone(e === thinking.effort))}
              >
                <RowText title={EFFORT_LABELS[e]} blurb={EFFORT_BLURBS[e]} />
                {e === thinking.effort ? <Check className="size-4 shrink-0" /> : null}
              </MenuPrimitive.RadioItem>
            ))}
          </MenuPrimitive.RadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="max-h-dvh overflow-y-auto rounded-t-sheet px-gutter pb-[max(env(safe-area-inset-bottom,0px),1rem)]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader className="px-0">
          <SheetTitle>Model</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-1 py-1">
          <div role="radiogroup" aria-label="Models" className="flex flex-col gap-1">
            {MODEL_IDS.map((id) => {
              const selected = id === model;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  disabled={locked(id)}
                  onKeyDown={onRadioKeyDown}
                  onClick={() => {
                    onChange({ model: id });
                    setOpen(false);
                  }}
                  className={cn(ROW, rowTone(selected), LOCKED)}
                >
                  <RowText title={MODELS[id].name} blurb={blurb(id)} />
                  {selected ? <Check className="size-4 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
          <div id={effortLabelId} className={GROUP_LABEL}>
            Effort
          </div>
          <div role="radiogroup" aria-labelledby={effortLabelId} className="flex flex-col gap-1">
            {EFFORTS.map((e) => {
              const selected = e === thinking.effort;
              return (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onKeyDown={onRadioKeyDown}
                  // Picking an effort keeps the sheet open.
                  onClick={() => onChange({ thinking: { effort: e } })}
                  className={cn(ROW, rowTone(selected))}
                >
                  <RowText title={EFFORT_LABELS[e]} blurb={EFFORT_BLURBS[e]} />
                  {selected ? <Check className="size-4 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
