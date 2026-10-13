"use client";
import Link from "next/link";
import { setPendingChat } from "@client/store/sidebar-store";

/** Where a fork's own turns begin; the rows above are the parent's. */
export function ForkDivider({ parentId }: { parentId: string | null }) {
  return (
    <div role="separator" className="flex items-center gap-3 text-caption text-muted-foreground" data-testid="fork-divider">
      <span className="h-px flex-1 bg-border" />
      <span>
        Forked from{" "}
        {parentId ? (
          <Link href={`/c/${parentId}`} prefetch={false} onNavigate={() => setPendingChat(parentId)} className="underline underline-offset-2 hover:text-foreground">
            main chat
          </Link>
        ) : (
          "main chat"
        )}
      </span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
