import { Suspense } from "react";
import { connection } from "next/server";
import { LoginForm } from "@client/components/auth/login-form";
import { guestsBlocked } from "@server/instance-settings";

export default function LoginPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center safe-x safe-top safe-bottom py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <h1 className="text-title font-semibold">Sign in</h1>
          <p className="text-small text-muted-foreground">Accounts are by invitation.</p>
        </div>
        <LoginForm />
        <Suspense fallback={null}>
          <GuestEntry />
        </Suspense>
      </div>
    </main>
  );
}

async function GuestEntry() {
  await connection();
  if (guestsBlocked()) return null;
  return (
    // An API route, not a page: a plain POST form, so the browser follows its redirect with the new cookie.
    <form action="/api/guest?next=/c" method="post" className="text-center text-small text-muted-foreground">
      <button type="submit" className="cursor-pointer underline">
        Continue as a guest
      </button>
    </form>
  );
}
