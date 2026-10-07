import { Suspense } from "react";
import { ChatView } from "@client/components/chat/chat-view";
import { SeedChat } from "@client/components/chat/seed-chat";
import { ChatViewSkeleton } from "@client/components/chat/chat-view-skeleton";
import { getChatWithMessages } from "@server/chats";
import { requireUser } from "@server/current-user";
import { isUuid } from "@shared/id";

// ADR-0005: the view is in the static shell and reads its id from the URL; the server's rows stream
// in through the Suspense child and seed the client store. An id with no rows is a new chat.
export default function ChatPage({ params }: PageProps<"/c/[id]">) {
  return (
    <Suspense fallback={<ChatViewSkeleton />}>
      <ChatView>
        <Suspense fallback={null}>
          <ChatSeed params={params} />
        </Suspense>
      </ChatView>
    </Suspense>
  );
}

async function ChatSeed({ params }: { params: PageProps<"/c/[id]">["params"] }) {
  const { id } = await params;
  if (!isUuid(id)) return null;
  const user = await requireUser();
  const data = getChatWithMessages(id, user.id);
  return <SeedChat chatId={id} title={data?.chat.title ?? null} updatedAt={data?.chat.updatedAt ?? null} rows={data?.messages ?? []} />;
}
