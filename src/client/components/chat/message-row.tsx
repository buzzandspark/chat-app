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
      className="[content-visibility:auto] [contain-intrinsic-size:auto_6rem]"
      data-role={message.role}
      data-message-id={id}
      data-status={message.status}
    >
      {message.role === "user" ? <UserMessage message={message} /> : <AssistantMessage message={message} />}
    </div>
  );
});
