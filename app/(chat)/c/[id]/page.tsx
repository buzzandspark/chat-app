import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChatView } from "@client/components/chat/chat-view";
import { ThreadSkeleton } from "@client/components/chat/thread-skeleton";
import { getChatWithMessages } from "@server/chats";
import { requireUser } from "@server/current-user";
import { env } from "@shared/env";
import { isUuid, uuidv7 } from "@shared/id";

export default function ChatPage({ params }: PageProps<"/c/[id]">) {
  return (
    <Suspense fallback={<ThreadSkeleton />}>
      <ChatLoader params={params} />
    </Suspense>
  );
}

async function ChatLoader({ params }: { params: PageProps<"/c/[id]">["params"] }) {
  const { id } = await params;
  const user = await requireUser();
  const scenarioPanel = env.scenarioPanel || user.role === "demo";
  if (id === "new") {
    return <ChatView key="new" chatId={uuidv7()} title={null} initialMessages={[]} isNew scenarioPanel={scenarioPanel} />;
  }
  if (!isUuid(id)) notFound();
  const data = getChatWithMessages(id, user.id);
  if (!data) notFound();
  return (
    <ChatView
      key={id}
      chatId={id}
      title={data.chat.title}
      initialMessages={data.messages}
      isNew={false}
      scenarioPanel={scenarioPanel}
    />
  );
}
