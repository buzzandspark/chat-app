"use client";
import { Button } from "@/components/ui/button";

export function InviteLink({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-accent/40 p-4" role="status">
      <p className="text-small font-medium">Link valid for 7 days, single use</p>
      <code className="block break-all rounded-md bg-code px-2 py-1.5 text-small text-code-foreground" data-testid="invite-url">
        {url}
      </code>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="touch-target"
          onClick={() => navigator.clipboard?.writeText(url).catch(() => {})}
        >
          Copy
        </Button>
        <Button type="button" size="sm" variant="ghost" className="touch-target" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
