"use client";
import type { MessageState } from "@client/store/chat-store";
import { textOf } from "@client/store/chat-store";

export function UserMessage({ message }: { message: MessageState }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble bg-bubble px-4 py-2.5 text-body text-bubble-foreground md:max-w-[75%]">
        {textOf(message.blocks)}
      </div>
    </div>
  );
}
