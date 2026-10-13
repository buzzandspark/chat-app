"use client";
import { useCallback, type ReactNode, type RefObject } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useBackGesture } from "@client/hooks/use-back-gesture";
import { useMediaQuery } from "@client/hooks/use-media-query";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  /** Where focus goes on close when it doesn't go to the composer; Radix has no trigger to return to here. */
  returnFocus?: RefObject<HTMLElement | null>;
  /** Radix's open focus, for a dialog that wants something other than its first field focused as is. */
  onOpenAutoFocus?: (e: Event) => void;
}

/** A bottom sheet on phones (slides from the bottom, follows the keyboard), a centred modal at `md`. */
export function ResponsiveDialog({ open, onOpenChange, title, description, children, className, returnFocus, onOpenAutoFocus }: ResponsiveDialogProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  // A sheet below `md` (as drawn), a centred modal at it: only the sheet takes the back gesture.
  const centred = useMediaQuery("(min-width: 768px)");
  useBackGesture(open && !centred, close);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={(e) => {
          // Back to the composer only where a keyboard is physical; on a phone that would cover the reply.
          const composer = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
          if (composer && window.matchMedia("(hover: hover) and (min-width: 768px)").matches) {
            e.preventDefault();
            composer.focus();
          } else if (returnFocus?.current) {
            e.preventDefault();
            returnFocus.current.focus();
          }
        }}
        className={cn(
          "fixed inset-x-0 top-auto bottom-0 w-full max-w-none sm:max-w-none translate-x-0 translate-y-0 rounded-t-sheet rounded-b-none px-gutter pt-5",
          // iOS does not resize the layout for its keyboard; the measured inset lifts the sheet above it.
          "pb-[max(env(safe-area-inset-bottom,0px),1rem)] [html[data-keyboard=open]_&]:pb-4 [html[data-keyboard=open]_&]:bottom-(--keyboard-inset)",
          "duration-250 data-open:zoom-in-100 data-open:slide-in-from-bottom-full data-closed:zoom-out-100 data-closed:slide-out-to-bottom-full",
          "md:top-1/2 md:bottom-auto md:left-1/2 md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:px-6 md:pb-6",
          "md:duration-150 md:data-open:zoom-in-95 md:data-open:slide-in-from-bottom-0 md:data-closed:zoom-out-95 md:data-closed:slide-out-to-bottom-0",
          className,
        )}
      >
        <DialogHeader className="text-left">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
