import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { lookupInvite } from "@auth/invites";
import { InviteForm } from "@client/components/auth/invite-form";
import { inviteProblem } from "@client/components/auth/invite-problem";

export const metadata: Metadata = { title: "Set your password" };

function Heading({ children }: { children: string }) {
  return (
    <div className="space-y-1 text-center">
      <h1 className="text-title font-semibold">{children}</h1>
    </div>
  );
}

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center safe-x safe-top safe-bottom py-10">
      <div className="w-full max-w-sm space-y-6">
        <Suspense fallback={<Heading>Set your password</Heading>}>
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
    return (
      <>
        <Heading>{inviteProblem(found.reason)}</Heading>
        <p className="text-center text-small text-muted-foreground">
          Ask the admin for a new link, or{" "}
          <Link href="/login" className="underline">
            sign in
          </Link>
          .
        </p>
      </>
    );
  }
  return (
    <>
      <Heading>Set your password</Heading>
      <InviteForm token={token} email={found.user.email} />
    </>
  );
}
