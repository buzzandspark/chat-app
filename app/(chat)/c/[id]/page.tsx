import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChatView } from "@client/components/chat/chat-view";
import { ChatViewSkeleton } from "@client/components/chat/thread-skeleton";
import { getChatWithMessages } from "@server/chats";
import { requireUser } from "@server/current-user";
import { env } from "@shared/env";
import { isUuid } from "@shared/id";

export default function ChatPage({ params }: PageProps<"/c/[id]">) {
  return (
    <Suspense fallback={<ChatViewSkeleton />}>
      <ChatLoader params={params} />
    </Suspense>
  );
}

// An id with no rows is a new chat (the engine creates the row on the first send), not a 404.
async function ChatLoader({ params }: { params: PageProps<"/c/[id]">["params"] }) {
  const { id } = await params;
  const user = await requireUser();
  if (!isUuid(id)) notFound();
  const scenarioPanel = env.scenarioPanel || user.role === "demo";
  const data = getChatWithMessages(id, user.id);
  return (
    <ChatView
      key={id}
      chatId={id}
      userId={user.id}
      title={data?.chat.title ?? null}
      updatedAt={data?.chat.updatedAt}
      initialMessages={data?.messages ?? []}
      isNew={data === null}
      scenarioPanel={scenarioPanel}
    />
  );
}
