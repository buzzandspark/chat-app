"use client";
import { memo } from "react";
import { useMessage } from "@client/store/hooks";
import { AssistantMessage } from "./assistant-message";
import { UserMessage } from "./user-message";

export const MessageRow = memo(function MessageRow({ id }: { id: string }) {
  const message = useMessage(id);
  if (!message) return null;
  return (
    <div
      // D14, only where scroll anchoring really works (a tested flag on <html>, see
      // theme-script.tsx): without it, skipped rows resize under the viewport and every
      // scroll-up step jumps, as iPhone Safari did. That containment clips paint to the row, so the row reaches
      // 14 px into the gutter (content unmoved) for a reply's ⋯, which sits flush with the text and overhangs it.
      className="-ml-3.5 pl-3.5 [html[data-scroll-anchoring=yes]_&]:[content-visibility:auto] [html[data-scroll-anchoring=yes]_&]:[contain-intrinsic-size:auto_6rem]"
      data-role={message.role}
      data-message-id={id}
      data-generation-id={message.generationId ?? undefined}
      data-status={message.status}
    >
      {message.role === "user" ? <UserMessage message={message} /> : <AssistantMessage message={message} />}
    </div>
  );
});
