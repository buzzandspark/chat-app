import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { LoginForm } from "@client/components/auth/login-form";
import { guestsBlocked } from "@server/instance-settings";
import { env } from "@shared/env";
import { GUEST_MODEL, MODELS } from "@shared/models";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center safe-x safe-top safe-bottom py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-title font-semibold">Sign in</h1>
          <p className="text-small text-muted-foreground">Accounts are invite-only.</p>
        </div>
        <LoginForm />
        <Suspense fallback={null}>
          <GuestEntry searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

/** Request-time, so the block switch and the cap are the running server's, not the build's. */
async function GuestEntry({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  await connection();
  if (guestsBlocked()) return null;
  const { guest } = await searchParams;
  return (
    // An API route, not a page: a plain POST form, so the browser follows its redirect with the new cookie.
    <form action="/api/guest?next=/c" method="post" className="space-y-1 text-center text-small text-muted-foreground">
      <button type="submit" className="cursor-pointer underline">
        Continue as guest
      </button>
      <p className="text-caption">
        Guests get {MODELS[GUEST_MODEL].short} and a ${env.GUEST_COST_CAP_USD.toFixed(2)} spending cap. Signing in later keeps your chats.
      </p>
      {guest === "unavailable" ? <p className="text-destructive">Guest access is busy right now. Sign in or try again later.</p> : null}
    </form>
  );
}
