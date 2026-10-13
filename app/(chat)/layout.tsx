import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache, Suspense } from "react";
import { ChatViewSkeleton } from "@client/components/chat/chat-view-skeleton";
import { ChatShell } from "@client/components/shell/chat-shell";
import { SettingsDefaults } from "@client/components/shell/settings-defaults";
import { ShellUserProvider } from "@client/components/shell/shell-user";
import { SidebarList, SidebarListSkeleton } from "@client/components/shell/sidebar-list";
import { SignInButton } from "@client/components/shell/sign-in-button";
import { SignOutButton } from "@client/components/shell/sign-out-button";
import { UsageBar } from "@client/components/shell/usage-bar";
import { listChats } from "@server/chats";
import { getCurrentUser, scenariosAllowed } from "@server/current-user";
import { capUsage, getUserSettings } from "@server/settings";

/**
 * The shell's chrome is static; only the chat list, the user label and the page need the session, each
 * streaming in behind its own Suspense. One session check per request serves all three.
 */
const currentUser = cache(async () => {
  const user = await getCurrentUser();
  if (!user) {
    // The cookie got past the proxy but the session is expired, purged or banned: sign in again, then come back.
    const path = (await headers()).get("x-pathname") ?? "/c";
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
      account={
        // Holds the button's width so the footer icons don't slide left when the session streams in.
        <Suspense fallback={<span aria-hidden className="touch-target" />}>
          <Account />
        </Suspense>
      }
      usage={
        <Suspense fallback={null}>
          <Usage />
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
  return <>{user.role === "guest" ? "Guest" : user.email}</>;
}

async function Usage() {
  const user = await currentUser();
  return <UsageBar initial={capUsage(user.id)} />;
}

async function Account() {
  const user = await currentUser();
  return user.role === "guest" ? <SignInButton /> : <SignOutButton />;
}

async function WithUser({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <ShellUserProvider userId={user.id} guest={user.role === "guest"} scenarioPanel={scenariosAllowed(user.role)} exploreOptions={getUserSettings(user.id).exploreOptions}>
      <SettingsDefaults />
      {children}
    </ShellUserProvider>
  );
}
