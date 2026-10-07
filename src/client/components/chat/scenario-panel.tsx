"use client";
import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { SCENARIO_NAMES, SCENARIOS, type ScenarioName } from "@relay/scenario-catalog";
import { markNavigationClose } from "@client/hooks/use-back-gesture";
import { IconButton } from "../ui/icon-button";
import { useModals } from "../ui/modal-manager";
import { ResponsiveDialog } from "../ui/responsive-dialog";
import { useChatContext } from "./chat-context";

interface ScenarioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (name: ScenarioName) => void;
  onSeedLongChat: () => void;
}

const ITEM =
  "flex min-h-12 w-full flex-col items-start rounded-lg px-3 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/50 active:bg-muted";

/** D24: every entry is served by a scripted provider server-side, so nothing here can spend money. */
export function ScenarioDialog({ open, onOpenChange, onPick, onSeedLongChat }: ScenarioDialogProps) {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Scenarios"
      description="Replayed and scripted streams. None of these call the live API."
      className="md:max-w-lg"
    >
      <ul className="-mx-1 max-h-[65dvh] overflow-y-auto md:max-h-[70vh]">
        <li>
          <button
            type="button"
            data-testid="scenario-long_chat"
            onClick={() => {
              markNavigationClose();
              onOpenChange(false);
              onSeedLongChat();
            }}
            className={ITEM}
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
                  onOpenChange(false);
                  onPick(name);
                }}
                className={ITEM}
              >
                <span className="text-body font-medium">{s.title}</span>
                <span className="text-caption text-muted-foreground">{s.blurb}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </ResponsiveDialog>
  );
}

export function ScenarioPanel({ autoOpen = false }: { autoOpen?: boolean }) {
  const { send } = useChatContext();
  const { show } = useModals();
  const router = useRouter();
  const seedLongChat = async () => {
    const res = await fetch("/api/scenarios/seed-long-chat", { method: "POST" });
    if (!res.ok) return;
    const body = (await res.json()) as { chatId: string };
    router.push(`/c/${body.chatId}`);
  };
  const openPanel = () =>
    show(({ open, close }) => (
      <ScenarioDialog
        open={open}
        onOpenChange={(o) => !o && close()}
        onPick={(name) => send(`Scenario: ${SCENARIOS[name].title}`, name)}
        onSeedLongChat={() => void seedLongChat()}
      />
    ));
  // The stand-in was pressed before this chunk arrived: open once, now that it can.
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current) return;
    opened.current = true;
    openPanel();
  });
  return (
    <IconButton label="Scenarios" tipSide="top" className="text-muted-foreground" data-testid="scenario-panel-trigger" onClick={openPanel}>
      <FlaskConical />
    </IconButton>
  );
}
