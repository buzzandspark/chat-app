"use client";
import { useRef, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { useShellUser } from "../shell/shell-user";

async function save(exploreOptions: boolean): Promise<boolean> {
  try {
    const res = await fetch("/api/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ exploreOptions }) });
    return res.ok;
  } catch {
    return false;
  }
}

/** The switch moves at once; a refused or lost save moves it back, unless a later flip has superseded it. */
export function ExploreToggle() {
  const { exploreOptions, setExploreOptions } = useShellUser();
  const [failed, setFailed] = useState(false);
  const latest = useRef(0);
  const change = async (on: boolean) => {
    const attempt = ++latest.current;
    setExploreOptions(on);
    setFailed(false);
    if (!(await save(on)) && attempt === latest.current) {
      setExploreOptions(!on);
      setFailed(true);
    }
  };
  return (
    <div>
      <div className="flex min-h-11 items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="explore-options" className="block text-small font-medium">
            Explore options
          </label>
          <p id="explore-options-hint" className="text-caption text-muted-foreground">
            Suggest alternatives to fork after a reply
          </p>
        </div>
        <Switch id="explore-options" checked={exploreOptions} onCheckedChange={(on) => void change(on)} aria-describedby="explore-options-hint" />
      </div>
      {failed ? (
        <p role="alert" className="text-caption text-destructive">
          Couldn&apos;t save. Try again.
        </p>
      ) : null}
    </div>
  );
}
