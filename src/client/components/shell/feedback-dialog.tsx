"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getChatStore } from "@client/store/chat-store";
import { ResponsiveDialog } from "../ui/responsive-dialog";

/** D25: feedback goes to the `feedback` table with the chat id and the latest reply's latency breakdown. */
export function FeedbackDialog({ open, onOpenChange, chatId }: { open: boolean; onOpenChange: (open: boolean) => void; chatId: string | null }) {
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">("idle");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setState("sending");
    const store = getChatStore();
    const ids = chatId ? store.getChat(chatId).messageIds : [];
    let messageId: string | undefined;
    let timings: unknown;
    for (let i = ids.length - 1; i >= 0; i--) {
      const m = store.getMessage(ids[i]!);
      if (m?.role === "assistant") {
        messageId = m.id;
        timings = m.timings ?? undefined;
        break;
      }
    }
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: body.trim(), chatId: chatId ?? undefined, messageId, timings }),
      });
      setState(res.ok ? "sent" : "failed");
      if (res.ok) setBody("");
    } catch {
      setState("failed");
    }
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Send feedback" description="What felt off, or what worked. The current chat's latency breakdown is attached.">
      {state === "sent" ? (
        <div className="space-y-3">
          <p className="text-body" role="status">
            Thanks, received.
          </p>
          <Button type="button" className="touch-target" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      ) : (
        <form onSubmit={(e) => void submit(e)} className="space-y-3">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} aria-label="Feedback" className="text-body" maxLength={4000} />
          {state === "failed" ? (
            <p role="alert" className="text-small text-destructive">
              Could not send. Try again.
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="touch-target" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="touch-target" disabled={!body.trim() || state === "sending"}>
              Send
            </Button>
          </div>
        </form>
      )}
    </ResponsiveDialog>
  );
}
