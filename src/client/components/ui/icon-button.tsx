"use client";
import { forwardRef, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type IconButtonProps = ComponentProps<typeof Button> & {
  /** Accessible name; also the hover tooltip on pointer devices (CSS, see `.tip`). */
  label: string;
  tipSide?: "top" | "bottom";
  /** Anchor the tooltip to the button's start or end edge when it sits near a viewport edge. */
  tipAlign?: "start" | "center" | "end";
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, tipSide = "bottom", tipAlign = "center", className, size = "icon", variant = "ghost", ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      aria-label={label}
      data-tip={label}
      data-tip-side={tipSide}
      data-tip-align={tipAlign}
      className={cn("tip touch-target", className)}
      {...props}
    />
  );
});
