"use client";
import { SCENARIO_NAMES, SCENARIOS, type ScenarioName } from "@relay/scenario-catalog";
import { markNavigationClose } from "@client/hooks/use-back-gesture";
import type { ModalRender } from "../ui/modal-manager";
import { ResponsiveDialog } from "../ui/responsive-dialog";

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

/** Opens the panel; the composer's Scenarios button calls it once this chunk has loaded. */
export function openScenarioPanel(show: (render: ModalRender) => () => void, send: (text: string, scenario?: string) => void, push: (href: string) => void): void {
  const seedLongChat = async () => {
    const res = await fetch("/api/scenarios/seed-long-chat", { method: "POST" });
    if (!res.ok) return;
    const body = (await res.json()) as { chatId: string };
    push(`/c/${body.chatId}`);
  };
  show(({ open, close }) => (
    <ScenarioDialog
      open={open}
      onOpenChange={(o) => !o && close()}
      onPick={(name) => send(`Scenario: ${SCENARIOS[name].title}`, name)}
      onSeedLongChat={() => void seedLongChat()}
    />
  ));
}
