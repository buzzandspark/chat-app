"use client";
import { forwardRef, useCallback, type ComponentProps, type FocusEvent, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TipAlign = "start" | "center" | "end";

type IconButtonProps = ComponentProps<typeof Button> & {
  /** Accessible name; also the hover tooltip on pointer devices (CSS, see `.tip`). */
  label: string;
  tipSide?: "top" | "bottom";
  /** Forces an alignment; by default the tooltip is centred and shifts to start or end only when centred it would leave its container. */
  tipAlign?: TipAlign;
  /** A keyboard shortcut, shown after the label in the tooltip, e.g. "⌘K". */
  shortcut?: string;
  /** False where the tooltip would only repeat what the button shows (a row's ⋯). */
  tip?: boolean;
};

const MARGIN = 4;

/**
 * Picks the alignment just before the tooltip shows; the hidden pseudo-element still has layout, so its width is readable.
 * The container is the nearest `[data-tip-boundary]`, else the viewport.
 */
function alignTip(el: HTMLElement): void {
  const width = Number.parseFloat(getComputedStyle(el, "::after").width);
  if (!Number.isFinite(width) || width <= 0) return;
  const rect = el.getBoundingClientRect();
  const boundary = el.closest<HTMLElement>("[data-tip-boundary]")?.getBoundingClientRect() ?? {
    left: 0,
    right: document.documentElement.clientWidth,
  };
  const centre = rect.left + rect.width / 2;
  let align: TipAlign = "center";
  if (centre - width / 2 < boundary.left + MARGIN) align = "start";
  else if (centre + width / 2 > boundary.right - MARGIN) align = "end";
  el.dataset.tipAlign = align;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, tip = true, tipSide = "bottom", tipAlign, className, size = "icon", variant = "ghost", onPointerEnter, onFocus, ...props },
  ref,
) {
  const auto = tipAlign === undefined;
  const enter = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      if (auto) alignTip(e.currentTarget);
      onPointerEnter?.(e);
    },
    [auto, onPointerEnter],
  );
  const focus = useCallback(
    (e: FocusEvent<HTMLButtonElement>) => {
      if (auto) alignTip(e.currentTarget);
      onFocus?.(e);
    },
    [auto, onFocus],
  );
  return (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      aria-label={label}
      data-tip={tip ? (shortcut ? `${label}  ${shortcut}` : label) : undefined}
      data-tip-side={tip ? tipSide : undefined}
      data-tip-align={tip ? (tipAlign ?? "center") : undefined}
      className={cn(tip && "tip", "touch-target", className)}
      onPointerEnter={enter}
      onFocus={focus}
      {...props}
    />
  );
});
