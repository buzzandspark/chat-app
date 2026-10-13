"use client";
import { Button } from "@/components/ui/button";
import { NO_CAP, parseCapText } from "@shared/cost-cap";
import type { AdminUserRow } from "@server/admin";
import { CAP_RANGE, type AdminActions } from "./use-admin-users";

function fmtDate(ms: number | null): string {
  if (!ms) return "–";
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function money(n: number | null): string {
  return n === null ? "no cap" : `$${n.toFixed(2)}`;
}

export function UserCard({ user: u, self, now, busy, act, patch, setNotice }: { user: AdminUserRow; self: boolean; now: number } & Pick<AdminActions, "busy" | "act" | "patch" | "setNotice">) {
  const inviteState = !u.invite ? null : u.invite.usedAt ? "used" : u.invite.revokedAt ? "revoked" : u.invite.expiresAt < now ? "expired" : "open";
  // Signing in needs a password, so an active user has one and a new link resets it (src/auth/invites.ts).
  const hasPassword = u.lastActiveAt !== null || inviteState === "used";
  return (
    <li className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid={`user-${u.email}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 truncate text-body font-medium">{u.email}</span>
        <span className="text-caption uppercase tracking-wide text-muted-foreground">
          {u.role}
          {u.banned ? " · disabled" : ""}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-small">
        <dt className="text-muted-foreground">Spent / cap</dt>
        <dd className="tabular-nums">
          ${u.costSpentUsd.toFixed(4)} / {money(u.costCapUsd)}
        </dd>
        <dt className="text-muted-foreground">Last active</dt>
        <dd>{fmtDate(u.lastActiveAt)}</dd>
        <dt className="text-muted-foreground">Invite</dt>
        <dd>{inviteState ?? "–"}</dd>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="touch-target"
          disabled={busy}
          onClick={() => void act("Couldn't create the link. Try again.", () => fetch(`/api/admin/users/${u.id}/invite`, { method: "POST" }))}
        >
          {hasPassword ? "Password reset link" : inviteState === "open" ? "Regenerate invite" : "Issue invite"}
        </Button>
        {inviteState === "open" ? (
          <Button size="sm" variant="outline" className="touch-target" disabled={busy} onClick={() => void act("Couldn't revoke the link. Try again.", () => fetch(`/api/admin/users/${u.id}/invite`, { method: "DELETE" }))}>
            {hasPassword ? "Revoke reset link" : "Revoke invite"}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          className="touch-target"
          disabled={busy}
          onClick={() => {
            const next = window.prompt(`Spending cap: ${CAP_RANGE}, or "${NO_CAP}" for no cap`, u.costCapUsd === null ? NO_CAP : String(u.costCapUsd));
            if (next === null) return;
            // Neither a typo nor an emptied answer becomes "no cap": only the word removes the cap.
            const parsed = parseCapText(next);
            if (!parsed.ok || parsed.cap === undefined) {
              const hint = `Enter ${CAP_RANGE}, or "${NO_CAP}" for no cap.`;
              setNotice(next.trim() ? `"${next.trim()}" isn't a cap. ${hint}` : hint);
              return;
            }
            void patch(u.id, { costCapUsd: parsed.cap }, "Couldn't update the cap. Try again.");
          }}
        >
          Edit cap
        </Button>
        {!self ? (
          <>
            <Button size="sm" variant="outline" className="touch-target" disabled={busy} onClick={() => void patch(u.id, { banned: !u.banned }, `Couldn't ${u.banned ? "enable" : "disable"} the account. Try again.`)}>
              {u.banned ? "Enable" : "Disable"}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="touch-target"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Delete ${u.email} and all their chats? This can't be undone.`)) {
                  void act("Couldn't delete the user. Try again.", () => fetch(`/api/admin/users/${u.id}`, { method: "DELETE" }));
                }
              }}
            >
              Delete
            </Button>
          </>
        ) : null}
      </div>
    </li>
  );
}
