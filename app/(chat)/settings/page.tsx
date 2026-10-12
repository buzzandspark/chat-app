import type { Metadata } from "next";
import { Suspense } from "react";
import { ExploreToggle } from "@client/components/settings/explore-toggle";
import { UsageSection, UsageSkeleton } from "@client/components/settings/usage-section";
import { getCurrentUser } from "@server/current-user";
import { usageSummary } from "@server/settings";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-thread space-y-8 safe-x pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]">
        <Suspense fallback={<UsageSkeleton />}>
          <Usage />
        </Suspense>
        <section aria-labelledby="settings-features" className="space-y-2">
          <h2 id="settings-features" className="text-title font-semibold">
            Features
          </h2>
          <ExploreToggle />
        </section>
      </div>
    </main>
  );
}

async function Usage() {
  // No session: the layout has already redirected to sign in.
  const user = await getCurrentUser();
  if (!user) return null;
  return <UsageSection usage={usageSummary(user.id, new Date())} />;
}
