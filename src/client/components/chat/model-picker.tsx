"use client";
import { Check, ChevronDown } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { DropdownMenu as MenuPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useBackGesture } from "@client/hooks/use-back-gesture";
import { useIsDesktop } from "@client/hooks/use-media-query";
import { MODEL_IDS, MODELS, type ModelId, GUEST_MODEL } from "@shared/models";
import type { ThinkingOptions } from "@shared/types";

// Shown only in the picker, so the main chunk carries names, not copy.
const MODEL_BLURBS: Record<ModelId, string> = {
  "claude-sonnet-5-5": "Fast and capable for everyday work",
  "claude-opus-5-5": "Deepest reasoning for hard problems",
  "claude-haiku-5-5": "Fastest replies at the lowest cost",
};

const THINKING_LABEL = "Think harder";

// Menu items are divs, so cursor-pointer/select-none give them the feel of the buttons the sheet uses.
const ROW = "flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50";
// A model a guest can't use: greyed out and inert (Radix marks a disabled item data-disabled).
const LOCKED = "data-disabled:cursor-not-allowed data-disabled:opacity-50 disabled:cursor-not-allowed disabled:opacity-50";
const rowTone = (selected: boolean) => (selected ? "bg-accent text-accent-foreground" : "hover:bg-muted active:bg-muted");

function RowText({ title, blurb }: { title: string; blurb: string }) {
  return (
    <span className="flex flex-col">
      <span className="text-body font-medium">{title}</span>
      <span className="text-caption text-muted-foreground">{blurb}</span>
    </span>
  );
}

const STEPS: Record<string, number> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/** The sheet's model rows are one tab stop; arrows (and Home/End) move between them. Picking closes the
 *  sheet, so unlike a form's radio group the arrows move focus only and Space/Enter picks. */
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
  const info = MODELS[model];

  const trigger = (
    <Button variant="ghost" size="sm" className="touch-target max-w-[55vw] gap-1 text-muted-foreground" aria-label={`Model: ${info.short}${thinking.harder ? ", think harder" : ""}`}>
      <span className="truncate">{info.short}</span>
      {thinking.harder ? <span className="rounded-md bg-accent px-1.5 text-caption text-accent-foreground">harder</span> : null}
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
          <MenuPrimitive.CheckboxItem
            checked={thinking.harder}
            onCheckedChange={(harder) => onChange({ thinking: { harder } })}
            // Toggling keeps the menu open.
            onSelect={(e) => e.preventDefault()}
            className={cn(ROW, "mt-1")}
          >
            <RowText title={THINKING_LABEL} blurb="Thinks longer before replying" />
            {/* The item is the menuitemcheckbox; the switch only draws its state. */}
            <Switch checked={thinking.harder} tabIndex={-1} aria-hidden className="pointer-events-none" />
          </MenuPrimitive.CheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-sheet px-gutter pb-[max(env(safe-area-inset-bottom,0px),1rem)]" onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader className="px-0">
          <SheetTitle>Model</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-1 py-1">
          {/* A radio group, with the switch outside it: a listbox may hold only options. */}
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
          <label className="mt-1 flex min-h-12 items-center justify-between gap-3 rounded-lg px-3 py-2.5">
            <RowText title={THINKING_LABEL} blurb="Thinks longer before replying" />
            <Switch checked={thinking.harder} onCheckedChange={(harder) => onChange({ thinking: { harder } })} aria-label={THINKING_LABEL} />
          </label>
        </div>
      </SheetContent>
    </Sheet>
  );
}
