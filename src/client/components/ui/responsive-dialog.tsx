"use client";
import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

/** D19: a bottom sheet on phones, a centred modal at md; bottom padding follows the keyboard. */
export function ResponsiveDialog({ open, onOpenChange, title, description, children, className }: ResponsiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        // D19: focus returns to the composer after a dialog closes.
        onCloseAutoFocus={(e) => {
          const composer = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
          if (composer) {
            e.preventDefault();
            composer.focus();
          }
        }}
        className={cn(
          "fixed inset-x-0 bottom-0 top-auto w-full max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-sheet px-gutter pt-5",
          "pb-[max(env(safe-area-inset-bottom,0px),1rem)] [html[data-keyboard=open]_&]:pb-4",
          "data-[state=open]:slide-in-from-bottom-10 data-[state=closed]:slide-out-to-bottom-10",
          "md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:px-6 md:pb-6",
          className,
        )}
      >
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{title}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
