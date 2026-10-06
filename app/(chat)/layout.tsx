import { Suspense } from "react";
import { ChatShell } from "@client/components/shell/chat-shell";
import { listChats } from "@server/chats";
import { requireUser } from "@server/current-user";

export default function ChatLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ShellWithData>{children}</ShellWithData>
    </Suspense>
  );
}

async function ShellWithData({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const chats = listChats(user.id);
  return (
    <ChatShell initialChats={chats} userLabel={user.email}>
      {children}
    </ChatShell>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex h-dvh w-full">
      <div className="hidden w-72 border-r border-border bg-sidebar md:block" />
      <div className="flex flex-1 flex-col">
        <div className="h-14 border-b border-border" />
      </div>
    </div>
  );
}
