"use client";
import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SCENARIO_NAMES, SCENARIOS } from "@relay/scenario-catalog";
import { useChatContext } from "./chat-context";

/**
 * D24: the scenario panel. Each entry sends a message with the scenario name;
 * the server forces a scripted provider for it, so nothing here can spend
 * money or bypass a cap.
 */
export function ScenarioPanel() {
  const { send } = useChatContext();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const seedLongChat = async () => {
    setOpen(false);
    const res = await fetch("/api/scenarios/seed-long-chat", { method: "POST" });
    if (!res.ok) return;
    const body = (await res.json()) as { chatId: string };
    router.push(`/c/${body.chatId}`);
  };
  return (
    <div className="mx-auto flex w-full max-w-thread justify-end px-gutter pb-1">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="touch-target text-muted-foreground" aria-label="Open scenario panel" data-testid="scenario-panel-trigger">
            <FlaskConical data-icon="inline-start" />
            Scenarios
          </Button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[80dvh] overflow-y-auto rounded-t-sheet px-gutter pb-[max(env(safe-area-inset-bottom,0px),1rem)] md:max-w-lg">
          <SheetHeader className="px-0">
            <SheetTitle>Scenarios</SheetTitle>
            <SheetDescription>Replayed and scripted streams. None of these call the live API.</SheetDescription>
          </SheetHeader>
          <ul className="flex flex-col gap-1">
            <li>
              <button
                type="button"
                data-testid="scenario-long_chat"
                onClick={() => void seedLongChat()}
                className="flex min-h-12 w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-muted active:bg-muted"
              >
                <span className="text-body font-medium">Extremely long chat</span>
                <span className="text-caption text-muted-foreground">Opens a seeded chat with 200 finished messages; then run any scenario in it.</span>
              </button>
            </li>
            {SCENARIO_NAMES.map((name) => {
              const s = SCENARIOS[name];
              return (
                <li key={name}>
                  <button
                    type="button"
                    data-testid={`scenario-${name}`}
                    onClick={() => {
                      setOpen(false);
                      send(`Scenario: ${s.title}`, name);
                    }}
                    className="flex min-h-12 w-full flex-col items-start rounded-lg px-3 py-2 text-left hover:bg-muted active:bg-muted"
                  >
                    <span className="text-body font-medium">{s.title}</span>
                    <span className="text-caption text-muted-foreground">{s.blurb}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}
