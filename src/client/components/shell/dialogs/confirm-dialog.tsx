"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@client/components/ui/responsive-dialog";
import type { DialogProps } from "./dialog-props";

const OFFLINE = "You're offline. Try again when you're connected.";

interface ConfirmDialogProps extends DialogProps {
  title: string;
  description: string;
  label: string;
  tone: "destructive" | "warning";
  /** Resolves to the error to show, or null once done. */
  onConfirm: () => Promise<string | null>;
}

export function ConfirmDialog({ open, onOpenChange, title, description, label, tone, onConfirm }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setError(await onConfirm());
    } catch {
      setError(OFFLINE);
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      // Opens on the confirm button, so Enter confirms.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        confirmRef.current?.focus();
      }}
    >
      {error ? (
        <p role="alert" className="text-small text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" className="touch-target" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button
          ref={confirmRef}
          type="button"
          variant={tone === "destructive" ? "destructive" : "default"}
          className={tone === "warning" ? "touch-target bg-warning text-white hover:bg-warning/85" : "touch-target"}
          disabled={busy}
          onClick={() => void confirm()}
        >
          {label}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}
