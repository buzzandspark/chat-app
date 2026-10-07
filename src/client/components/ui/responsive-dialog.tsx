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

/** D19: a bottom sheet on phones (slides from the bottom, follows the keyboard), a centred modal at `md`. */
export function ResponsiveDialog({ open, onOpenChange, title, description, children, className }: ResponsiveDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        onCloseAutoFocus={(e) => {
          const composer = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
          if (composer) {
            e.preventDefault();
            composer.focus();
          }
        }}
        className={cn(
          "fixed inset-x-0 top-auto bottom-0 w-full max-w-none translate-x-0 translate-y-0 rounded-t-sheet rounded-b-none px-gutter pt-5",
          "pb-[max(env(safe-area-inset-bottom,0px),1rem)] [html[data-keyboard=open]_&]:pb-4",
          "duration-250 data-open:zoom-in-100 data-open:slide-in-from-bottom-full data-closed:zoom-out-100 data-closed:slide-out-to-bottom-full",
          "md:top-1/2 md:bottom-auto md:left-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:px-6 md:pb-6",
          "md:duration-150 md:data-open:zoom-in-95 md:data-open:slide-in-from-bottom-0 md:data-closed:zoom-out-95 md:data-closed:slide-out-to-bottom-0",
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
