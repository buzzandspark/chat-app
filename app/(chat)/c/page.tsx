import { Suspense } from "react";
import { ChatView } from "@client/components/chat/chat-view";
import { ChatViewSkeleton } from "@client/components/chat/chat-view-skeleton";
import { NewChatSeed } from "@client/components/chat/new-chat-seed";

// A new chat lives at /c until its first send rewrites the address to /c/<id> in place (no remount).
export default function NewChatPage() {
  return (
    <Suspense fallback={<ChatViewSkeleton />}>
      <ChatView>
        <NewChatSeed />
      </ChatView>
    </Suspense>
  );
}
