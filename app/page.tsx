import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TryDemoButton } from "@client/components/auth/try-demo-button";

export default function LandingPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center safe-x safe-top safe-bottom py-12">
      <div className="w-full max-w-md space-y-6 text-center">
        <p className="text-caption uppercase tracking-[0.2em] text-muted-foreground">Cadence</p>
        <h1 className="text-display font-semibold tracking-tight">A chat client that keeps its rhythm on a bad connection.</h1>
        <p className="text-body text-muted-foreground">
          Streaming that survives a dropped tab, a backgrounded phone, and a server restart. The demo replays recorded
          streams, so nothing here spends money.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <TryDemoButton />
          <Link href="/login" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "touch-target")}>
            Sign in
          </Link>
        </div>
        <p className="text-caption text-muted-foreground">
          <a className="underline" href="https://github.com/bzahory/cadence" target="_blank" rel="noreferrer">
            Source and design notes
          </a>
        </p>
      </div>
    </main>
  );
}
