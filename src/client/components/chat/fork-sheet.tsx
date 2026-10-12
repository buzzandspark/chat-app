"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { markNavigationClose } from "@client/hooks/use-back-gesture";
import { rewriteOptions } from "@client/store/forks";
import { MAX_FORKS, MAX_OPTION_PROMPT, MAX_OPTION_TITLE, type ForkOption } from "@shared/forks";
import { ResponsiveDialog } from "../ui/responsive-dialog";

interface ForkSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  options: readonly ForkOption[];
  /** `onListed` closes the sheet as soon as the forks exist, so the tabs' reveal plays in the open. */
  onFork: (options: readonly ForkOption[], onListed: () => void) => Promise<{ ok: boolean; error?: string }>;
}

type Item = ForkOption & { selected: boolean };

/** Pick, retitle and reword the options before forking; one instruction can rewrite every prompt. */
export function ForkSheet({ open, onOpenChange, messageId, options, onFork }: ForkSheetProps) {
  const [items, setItems] = useState<Item[]>(() => options.map((o, i) => ({ ...o, selected: i < MAX_FORKS })));
  const [instruction, setInstruction] = useState("");
  const [applying, setApplying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instructionRef = useRef<HTMLInputElement>(null);
  // Opens on the instruction: one line there reaches every prompt. After Radix's own open focus, so this one wins.
  useEffect(() => {
    const t = setTimeout(() => instructionRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);
  const selected = items.filter((it) => it.selected);
  const update = (index: number, patch: Partial<Item>) => setItems((list) => list.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  const toggle = (index: number) => {
    const it = items[index]!;
    if (!it.selected && selected.length >= MAX_FORKS) return;
    update(index, { selected: !it.selected });
  };

  const apply = async () => {
    if (!instruction.trim() || applying) return;
    setApplying(true);
    setError(null);
    const out = await rewriteOptions(messageId, instruction.trim(), items.map(({ title, prompt }) => ({ title, prompt })));
    setApplying(false);
    if (!out.ok) {
      setError(out.error);
      return;
    }
    setItems((list) => list.map((it, i) => (out.options[i] ? { ...it, ...out.options[i] } : it)));
  };

  const submit = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    let closed = false;
    // The first fork is about to be opened: the sheet's history entry must stay, or going back would undo it.
    const close = () => {
      if (closed) return;
      closed = true;
      markNavigationClose();
      onOpenChange(false);
    };
    const out = await onFork(
      selected.map(({ title, prompt }) => ({ title: title.trim(), prompt: prompt.trim() })),
      close,
    );
    setBusy(false);
    if (!out.ok) {
      setError(out.error ?? "Forking failed.");
      return;
    }
    close();
  };

  // Enter in the instruction applies it; Shift+Enter anywhere forks; Enter in another field does nothing.
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    if (e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.target === instructionRef.current) {
      e.preventDefault();
      void apply();
    } else if ((e.target as HTMLElement).tagName === "INPUT") {
      e.preventDefault();
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Explore options" description={`Each option becomes its own chat, up to ${MAX_FORKS}.`} className="md:max-w-xl">
      <form
        className="flex flex-col gap-3"
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ul className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1" data-testid="fork-sheet-options">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 rounded-lg border border-border p-2">
              <input type="checkbox" className="mt-2.5 size-4 shrink-0 accent-primary" checked={it.selected} onChange={() => toggle(i)} aria-label={`Fork ${it.title}`} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Input value={it.title} onChange={(e) => update(i, { title: e.target.value })} maxLength={MAX_OPTION_TITLE} aria-label="Tab title" className="h-9" />
                <Textarea value={it.prompt} onChange={(e) => update(i, { prompt: e.target.value })} maxLength={MAX_OPTION_PROMPT} aria-label="First message" rows={2} className="text-small" />
              </div>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input
            ref={instructionRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="Instruction for every prompt, e.g. assess performance"
            aria-label="Instruction for all prompts"
            maxLength={500}
            className="h-9"
          />
          <Button type="button" variant="outline" className="touch-target" disabled={!instruction.trim() || applying} onClick={() => void apply()}>
            {applying ? "Applying…" : "Apply"}
          </Button>
        </div>
        {error ? (
          <p role="alert" className="text-small text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="touch-target" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" className="touch-target" disabled={selected.length === 0 || busy || selected.some((it) => !it.title.trim() || !it.prompt.trim())}>
            {busy ? "Forking…" : `Fork ${selected.length} chat${selected.length === 1 ? "" : "s"}`}
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
}
