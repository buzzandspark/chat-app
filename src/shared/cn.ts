import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom tokens from app/globals.css so conflicts resolve the same as built-in ones.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "small", "body", "title", "display"],
      radius: ["sheet", "bubble"],
      spacing: ["gutter", "thread", "touch", "composer"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
