"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useNow } from "@client/hooks/use-now";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AdminUserRow } from "@server/admin";

function fmtDate(ms: number | null): string {
  if (!ms) return "–";
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}

function money(n: number | null): string {
  return n === null ? "no cap" : `$${n.toFixed(2)}`;
}

/** D7: phone-first (cards) and a table at md; every action is a 44 px target. */
export function AdminConsole({ initialUsers, selfId }: { initialUsers: AdminUserRow[]; selfId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [email, setEmail] = useState("");
  const [cap, setCap] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const now = useNow(60_000);

  const refresh = async () => {
    const res = await fetch("/api/admin/users");
    if (res.ok) setUsers(((await res.json()) as { users: AdminUserRow[] }).users);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, costCapUsd: cap === "" ? null : Number(cap) }),
    });
    const body = (await res.json().catch(() => ({}))) as { inviteUrl?: string; error?: string };
    setBusy(false);
    if (!res.ok) {
      setNotice(body.error === "email_taken" ? "That email already has an account." : "Could not create the user.");
      return;
    }
    setInviteUrl(body.inviteUrl ?? null);
    setEmail("");
    setCap("");
    await refresh();
  };

  const act = async (label: string, run: () => Promise<Response>) => {
    setBusy(true);
    setNotice(null);
    const res = await run();
    setBusy(false);
    if (!res.ok) setNotice(`${label} failed (${res.status}).`);
    else {
      const body = (await res.json().catch(() => ({}))) as { inviteUrl?: string };
      if (body.inviteUrl) setInviteUrl(body.inviteUrl);
    }
    await refresh();
  };

  const patch = (id: string, data: Record<string, unknown>, label: string) =>
    act(label, () => fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }));

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 safe-x safe-top safe-bottom py-6">
      <header className="space-y-1">
        <p className="text-caption uppercase tracking-[0.2em] text-muted-foreground">Cadence</p>
        <h1 className="text-title font-semibold">Admin</h1>
      </header>

      <form onSubmit={(e) => void create(e)} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[1fr_10rem_auto] md:items-end" aria-label="Create user">
        <div className="space-y-1.5">
          <Label htmlFor="new-email">Email</Label>
          <Input id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 text-body" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="new-cap">Cost cap (USD, optional)</Label>
          <Input id="new-cap" type="number" min={0} step="0.5" inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} className="h-11 text-body" />
        </div>
        <Button type="submit" className="touch-target" disabled={busy || !email}>
          Create and invite
        </Button>
      </form>

      {inviteUrl ? (
        <div className="space-y-2 rounded-xl border border-border bg-accent/40 p-4" role="status">
          <p className="text-small font-medium">Invite link (valid 7 days, single use)</p>
          <code className="block break-all rounded-md bg-code px-2 py-1.5 text-small text-code-foreground" data-testid="invite-url">
            {inviteUrl}
          </code>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="touch-target"
              onClick={() => navigator.clipboard?.writeText(inviteUrl).catch(() => {})}
            >
              Copy
            </Button>
            <Button type="button" size="sm" variant="ghost" className="touch-target" onClick={() => setInviteUrl(null)}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}
      {notice ? (
        <p role="alert" className="text-small text-destructive">
          {notice}
        </p>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2" aria-label="Users">
        {users.map((u) => {
          const self = u.id === selfId;
          const inviteState = !u.invite ? null : u.invite.usedAt ? "used" : u.invite.revokedAt ? "revoked" : u.invite.expiresAt < now ? "expired" : "open";
          return (
            <li key={u.id} className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid={`user-${u.email}`}>
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
              {u.role !== "demo" ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" className="touch-target" disabled={busy} onClick={() => void act("Invite", () => fetch(`/api/admin/users/${u.id}/invite`, { method: "POST" }))}>
                    {inviteState === "open" ? "Regenerate invite" : "Issue invite"}
                  </Button>
                  {inviteState === "open" ? (
                    <Button size="sm" variant="ghost" className="touch-target" disabled={busy} onClick={() => void act("Revoke", () => fetch(`/api/admin/users/${u.id}/invite`, { method: "DELETE" }))}>
                      Revoke
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="touch-target"
                    disabled={busy}
                    onClick={() => {
                      const next = window.prompt("Cost cap in USD (empty for no cap)", u.costCapUsd === null ? "" : String(u.costCapUsd));
                      if (next === null) return;
                      void patch(u.id, { costCapUsd: next.trim() === "" ? null : Number(next) }, "Cap");
                    }}
                  >
                    Edit cap
                  </Button>
                  {!self ? (
                    <>
                      <Button size="sm" variant="outline" className="touch-target" disabled={busy} onClick={() => void patch(u.id, { banned: !u.banned }, u.banned ? "Enable" : "Disable")}>
                        {u.banned ? "Enable" : "Disable"}
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="touch-target"
                        disabled={busy}
                        onClick={() => {
                          if (window.confirm(`Delete ${u.email} and all their chats?`)) {
                            void act("Delete", () => fetch(`/api/admin/users/${u.id}`, { method: "DELETE" }));
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
