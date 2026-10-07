import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ChatShell } from "@client/components/shell/chat-shell";
import { listChats } from "@server/chats";
import { getCurrentUser } from "@server/current-user";

export default function ChatLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ShellWithData>{children}</ShellWithData>
    </Suspense>
  );
}

async function ShellWithData({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) {
    // The cookie got past the proxy but the session is expired, purged or banned: sign in again, then come back.
    const path = (await headers()).get("x-cadence-path") ?? "/c/new";
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  const chats = listChats(user.id);
  return (
    <ChatShell initialChats={chats} userId={user.id} userLabel={user.email} scenarioPanel>
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
