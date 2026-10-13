// @vitest-environment node
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getSidebarStore, useSidebarChats, type ChatSummary } from "./sidebar-store";

function Titles({ initial }: { initial: ChatSummary[] }) {
  return <>{useSidebarChats(initial).map((c) => c.title).join(",")}</>;
}

describe("useSidebarChats on the server", () => {
  it("renders each request's rows without keeping them in the process-wide store", () => {
    expect(renderToString(<Titles initial={[{ id: "a", title: "Alpha plans", updatedAt: 1 }]} />)).toContain("Alpha plans");
    expect(renderToString(<Titles initial={[{ id: "b", title: "Beta notes", updatedAt: 2 }]} />)).not.toContain("Alpha");
    expect(getSidebarStore().get()).toEqual([]);
  });
});
