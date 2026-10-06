import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { lookupInvite } from "@auth/invites";
import { InviteForm } from "@client/components/auth/invite-form";

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center safe-x safe-top safe-bottom py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <p className="text-caption uppercase tracking-[0.2em] text-muted-foreground">Cadence</p>
          <h1 className="text-title font-semibold">Set your password</h1>
        </div>
        <Suspense fallback={null}>
          <InviteBody params={params} />
        </Suspense>
      </div>
    </main>
  );
}

async function InviteBody({ params }: { params: PageProps<"/invite/[token]">["params"] }) {
  await connection();
  const { token } = await params;
  const found = lookupInvite(token);
  if (!found.ok) {
    const text =
      found.reason === "used"
        ? "This invite has already been used."
        : found.reason === "expired"
          ? "This invite has expired."
          : found.reason === "revoked"
            ? "This invite was revoked."
            : "This invite link is not valid.";
    return (
      <div className="space-y-4 text-center">
        <p role="alert" className="text-body">
          {text}
        </p>
        <p className="text-small text-muted-foreground">
          Ask the admin for a new link, or{" "}
          <Link href="/login" className="underline">
            sign in
          </Link>
          .
        </p>
      </div>
    );
  }
  return <InviteForm token={token} email={found.user.email} />;
}
