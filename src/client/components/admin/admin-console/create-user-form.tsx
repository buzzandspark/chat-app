"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NO_CAP, parseCapText } from "@shared/cost-cap";
import { CAP_RANGE, type AdminActions } from "./use-admin-users";

export function CreateUserForm({ defaultCapUsd, busy, create, setNotice }: { defaultCapUsd: number } & Pick<AdminActions, "busy" | "create" | "setNotice">) {
  const [email, setEmail] = useState("");
  const [cap, setCap] = useState("");
  const [noCap, setNoCap] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Blank leaves costCapUsd out and the server applies the default shown as the placeholder; no cap
    // is only ever the box, so clearing the field cannot uncap anyone.
    const parsed = noCap ? ({ ok: true, cap: NO_CAP } as const) : parseCapText(cap);
    if (!parsed.ok) {
      setNotice(`"${cap.trim()}" isn't a cap. Enter ${CAP_RANGE}, or leave it blank for the default.`);
      return;
    }
    if (!(await create(email, parsed.cap))) return;
    setEmail("");
    setCap("");
    setNoCap(false);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-[1fr_10rem_auto_auto] md:items-end" aria-label="Create user">
      <div className="space-y-1.5">
        <Label htmlFor="new-email">Email</Label>
        <Input id="new-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 text-body" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-cap">Spending cap (USD)</Label>
        <Input
          id="new-cap"
          type="number"
          min={0}
          // Any amount: a step would make the browser refuse caps between its increments.
          step="any"
          inputMode="decimal"
          placeholder={`${defaultCapUsd} (default)`}
          disabled={noCap}
          value={noCap ? "" : cap}
          onChange={(e) => setCap(e.target.value)}
          className="h-11 text-body"
        />
      </div>
      <label className="touch-target flex items-center gap-2 text-small">
        <input type="checkbox" className="size-4" checked={noCap} onChange={(e) => setNoCap(e.target.checked)} />
        No cap
      </label>
      <Button type="submit" className="touch-target" disabled={busy || !email}>
        Create and invite
      </Button>
    </form>
  );
}
