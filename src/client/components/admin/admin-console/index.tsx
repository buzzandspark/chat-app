"use client";
import { useNow } from "@client/hooks/use-now";
import { Switch } from "@/components/ui/switch";
import type { AdminUserRow } from "@server/admin";
import { CreateUserForm } from "./create-user-form";
import { InviteLink } from "./invite-link";
import { useAdminUsers } from "./use-admin-users";
import { UserCard } from "./user-card";

/** Phone-first (cards) and a table at md; every action is a 44 px target. */
export function AdminConsole({
  initialUsers,
  selfId,
  defaultCapUsd,
  initialGuestsBlocked,
}: {
  initialUsers: AdminUserRow[];
  selfId: string;
  defaultCapUsd: number;
  initialGuestsBlocked: boolean;
}) {
  const admin = useAdminUsers(initialUsers, initialGuestsBlocked);
  const now = useNow(60_000);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 safe-x safe-top safe-bottom py-6">
      <header className="space-y-1">
        <h1 className="text-title font-semibold">Admin</h1>
      </header>

      <div className="flex min-h-11 items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="block-guests" className="block text-small font-medium">
            Block guests
          </label>
          <p id="block-guests-hint" className="text-caption text-muted-foreground">
            No new guests. Current guests can read their chats but can&apos;t send, fork or use Explore.
          </p>
        </div>
        <Switch id="block-guests" checked={admin.guestsBlocked} disabled={admin.busy} onCheckedChange={(on) => void admin.blockGuests(on)} aria-describedby="block-guests-hint" />
      </div>

      <CreateUserForm defaultCapUsd={defaultCapUsd} busy={admin.busy} create={admin.create} setNotice={admin.setNotice} />

      {admin.inviteUrl ? <InviteLink url={admin.inviteUrl} onDismiss={() => admin.setInviteUrl(null)} /> : null}
      {admin.notice ? (
        <p role="alert" className="text-small text-destructive">
          {admin.notice}
        </p>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2" aria-label="Users">
        {admin.users.map((u) => (
          <UserCard key={u.id} user={u} self={u.id === selfId} now={now} busy={admin.busy} act={admin.act} patch={admin.patch} setNotice={admin.setNotice} />
        ))}
      </ul>
    </main>
  );
}
