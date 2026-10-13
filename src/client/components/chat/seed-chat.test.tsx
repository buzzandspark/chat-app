import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { SeedRow } from "@client/store/chat-store";
import { ChatStoreProvider, useChatStore } from "@client/store/context";
import { getSidebarStore } from "@client/store/sidebar-store";
import { SeedChat } from "./seed-chat";

vi.mock("@client/transport/generation-client", () => ({ getGenerationClient: () => ({ attach: () => {} }) }));

const CHAT = "0199a000-0000-7000-8000-000000000001";
const rows: SeedRow[] = [
  {
    id: "u1",
    chatId: CHAT,
    role: "user",
    content: [{ type: "text", text: "doomed", citations: null }],
    status: "done",
    requestedModel: null,
    servingModel: null,
    stopReason: null,
    refusal: null,
    error: null,
    generationId: null,
    createdAt: 1,
  },
];

function Deleted({ children }: { children: React.ReactNode }) {
  useChatStore().removeChat(CHAT);
  return <>{children}</>;
}

describe("SeedChat", () => {
  afterEach(cleanup);

  it("does not put a chat deleted here back in the sidebar when a cached page of it renders", () => {
    getSidebarStore().hydrate([], "u1");
    render(
      <ChatStoreProvider>
        <Deleted>
          <SeedChat chatId={CHAT} title="Doomed chat" updatedAt={1} rows={rows} />
        </Deleted>
      </ChatStoreProvider>,
    );
    expect(getSidebarStore().get()).toEqual([]);
  });
});
