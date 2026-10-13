"use client";
import { FlaskConical } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ComponentProps } from "react";
import { chunk } from "@client/components/ui/lazy-chunk";
import { useModals } from "@client/components/ui/modal-manager";
import { IconButton } from "@client/components/ui/icon-button";
import { useChatActions } from "../chat-context";

// The panel's chunk (a Radix dialog) loads on intent.
function ScenarioButton(props: Omit<ComponentProps<typeof IconButton>, "label" | "children">) {
  return (
    <IconButton label="Scenarios" tipSide="top" className="text-muted-foreground" {...props}>
      <FlaskConical />
    </IconButton>
  );
}
const loadScenarioPanel = chunk(() => import("./scenario-panel"));

// The button opens the panel itself, once the chunk is in; a chunk that fails is thrown to the boundary around it.
export function ScenarioPanelOnIntent() {
  const { send } = useChatActions();
  const { show } = useModals();
  const router = useRouter();
  const [failed, setFailed] = useState<{ error: unknown } | null>(null);
  // A second press while the chunk is still on its way doesn't stack a second panel.
  const opening = useRef(false);
  if (failed) throw failed.error;
  const warm = () => {
    loadScenarioPanel().catch(() => {});
  };
  return (
    <ScenarioButton
      data-testid="scenario-panel-trigger"
      onPointerEnter={warm}
      onTouchStart={warm}
      onFocus={warm}
      onClick={() => {
        if (opening.current) return;
        opening.current = true;
        loadScenarioPanel()
          .then((m) => m.openScenarioPanel(show, send, router.push), (error: unknown) => setFailed({ error }))
          .finally(() => {
            opening.current = false;
          });
      }}
    />
  );
}
