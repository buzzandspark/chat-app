import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache, Suspense } from "react";
import { ChatViewSkeleton } from "@client/components/chat/chat-view-skeleton";
import { ChatShell } from "@client/components/shell/chat-shell";
import { SettingsDefaults } from "@client/components/shell/settings-defaults";
import { ShellUserProvider } from "@client/components/shell/shell-user";
import { SidebarList, SidebarListSkeleton } from "@client/components/shell/sidebar-list";
import { listChats } from "@server/chats";
import { getCurrentUser } from "@server/current-user";

/**
 * #20: the shell's chrome (sidebar frame, header, composer geometry) is in the static shell; only the
 * three things that need the session stream in, each behind its own Suspense: the chat list, the
 * user label and the page. One session check per request serves all three.
 */
const currentUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) {
    // The cookie got past the proxy but the session is expired, purged or banned: sign in again, then come back.
    const path = (await headers()).get("x-cadence-path") ?? "/c/new";
    redirect(`/login?next=${encodeURIComponent(path)}`);
  }
  return user;
});

export default function ChatLayout({ children }: LayoutProps<"/">) {
  return (
    <ChatShell
      sidebarList={
        <Suspense fallback={<SidebarListSkeleton />}>
          <SidebarListData />
        </Suspense>
      }
      userLabel={
        <Suspense fallback={null}>
          <UserLabel />
        </Suspense>
      }
    >
      <Suspense fallback={<ChatViewSkeleton />}>
        <WithUser>{children}</WithUser>
      </Suspense>
    </ChatShell>
  );
}

async function SidebarListData() {
  const user = await currentUser();
  return <SidebarList initialChats={listChats(user.id)} />;
}

async function UserLabel() {
  const user = await currentUser();
  return <>{user.email}</>;
}

async function WithUser({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <ShellUserProvider userId={user.id} scenarioPanel>
      <SettingsDefaults />
      {children}
    </ShellUserProvider>
  );
}
