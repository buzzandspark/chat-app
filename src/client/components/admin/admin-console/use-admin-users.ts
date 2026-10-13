"use client";
import { useState } from "react";
import { readJson, type AdminUsersResponse, type ApiError, type CreateUserResponse, type InviteResponse } from "@shared/api";
import { MAX_COST_CAP_USD, type CapField } from "@shared/cost-cap";
import type { AdminUserRow } from "@server/admin";

const OFFLINE = "You're offline. Try again when you're connected.";
export const CAP_RANGE = `a dollar amount up to $${MAX_COST_CAP_USD.toLocaleString("en")}`;

/** The user list, the guest switch and every admin action on them; one action runs at a time. */
export function useAdminUsers(initialUsers: AdminUserRow[], initialGuestsBlocked: boolean) {
  const [users, setUsers] = useState(initialUsers);
  const [guestsBlocked, setGuestsBlocked] = useState(initialGuestsBlocked);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) setUsers((await readJson<AdminUsersResponse>(res)).users);
    } catch {
      // Offline: keep the list we have; the next action refreshes it.
    }
  };

  /** True once the user exists, so the form clears while the list refreshes. */
  const create = async (email: string, costCapUsd: CapField | undefined): Promise<boolean> => {
    setBusy(true);
    setNotice(null);
    let res: Response;
    let body: Partial<CreateUserResponse & ApiError>;
    try {
      res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, costCapUsd }),
      });
      body = await readJson<CreateUserResponse & ApiError>(res).catch(() => ({}));
    } catch {
      setNotice(OFFLINE);
      return false;
    } finally {
      setBusy(false);
    }
    if (!res.ok) {
      setNotice(body.error === "email_taken" ? "That email already has an account." : "Couldn't create the user. Try again.");
      return false;
    }
    setInviteUrl(body.inviteUrl ?? null);
    void refresh();
    return true;
  };

  /** `failure` is the notice for a refused action. */
  const act = async (failure: string, run: () => Promise<Response>) => {
    setBusy(true);
    setNotice(null);
    let res: Response;
    try {
      res = await run();
    } catch {
      setNotice(OFFLINE);
      return;
    } finally {
      setBusy(false);
    }
    if (!res.ok) setNotice(failure);
    else {
      const body: Partial<InviteResponse> = await readJson<InviteResponse>(res).catch(() => ({}));
      if (body.inviteUrl) setInviteUrl(body.inviteUrl);
    }
    await refresh();
  };

  const blockGuests = async (blocked: boolean) => {
    setGuestsBlocked(blocked);
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/admin/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guestsBlocked: blocked }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setGuestsBlocked(!blocked);
      setNotice("Couldn't change guest access. Try again.");
    }
  };

  const patch = (id: string, data: Record<string, unknown>, failure: string) =>
    act(failure, () => fetch(`/api/admin/users/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }));

  return { users, guestsBlocked, busy, notice, setNotice, inviteUrl, setInviteUrl, create, act, blockGuests, patch };
}

export type AdminActions = ReturnType<typeof useAdminUsers>;
