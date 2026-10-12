import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { SeedRow } from "@client/store/chat-store";

const CHAT = "0199a000-0000-7000-8000-000000000001";

// The Markdown chunk (#83) is ready.ts's lazy import: each test decides how it loads.
const chunk = { load: (): Promise<unknown> => new Promise(() => {}) };
vi.mock("next/navigation", () => ({ useParams: () => ({ id: CHAT }), useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: () => {}, prefetch: () => {}, refresh: () => {} }) }));
vi.mock("@client/hooks/use-new-chat", () => ({ useNewChat: () => () => {} }));
vi.mock("@client/transport/generation-client", () => ({ getGenerationClient: () => ({ send: () => {}, attach: () => {} }) }));
vi.mock("./composer", () => ({ Composer: () => null }));

const rendered = { Markdown: ({ text }: { text: string }) => <div data-testid="markdown">{text}</div> };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const row = (id: string, role: "user" | "assistant", text: string): SeedRow => ({
  id,
  chatId: CHAT,
  role,
  content: [{ type: "text", text, citations: null }],
  status: "done",
  requestedModel: null,
  servingModel: null,
  stopReason: null,
  refusal: null,
  error: null,
  timings: null,
  generationId: null,
  createdAt: 1,
});

// A fresh module graph per test: ready.ts starts its fetch when it evaluates and keeps the result.
async function mount(prepare: (store: import("@client/store/chat-store").ChatStore) => void) {
  vi.resetModules();
  vi.doMock("@client/markdown/Markdown", () => chunk.load());
  const [{ ChatView }, { ChatStoreProvider, useChatStore }, { ShellUserProvider }, { createMessageState }, { ModalProvider }] = await Promise.all([
    import("./chat-view"),
    import("@client/store/context"),
    import("../shell/shell-user"),
    import("@client/store/chat-store"),
    import("../ui/modal-manager"),
  ]);
  let store!: import("@client/store/chat-store").ChatStore;
  function Seed() {
    const s = useChatStore();
    if (!store) {
      store = s;
      prepare(s);
    }
    return null;
  }
  render(
    <ChatStoreProvider>
      <ModalProvider>
        <ShellUserProvider userId="u1" guest={false} scenarioPanel={false} exploreOptions={false}>
          <ChatView>
            <Seed />
          </ChatView>
        </ShellUserProvider>
      </ModalProvider>
    </ChatStoreProvider>,
  );
  return { store, createMessageState };
}

const flush = () => act(async () => {});

describe("Thread and the Markdown chunk (#83)", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    Element.prototype.scrollTo = () => {};
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps a saved chat behind the skeleton while the renderer loads, then shows it rendered", async () => {
    const load = deferred();
    chunk.load = () => load.promise.then(() => rendered);
    await mount((s) => s.seedChat(CHAT, "Saved", [row("m1", "user", "hi"), row("m2", "assistant", "**hello**")]));
    await flush();
    expect(screen.getByTestId("thread-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("hi")).toBeNull();

    await act(async () => load.resolve());
    expect(screen.queryByTestId("thread-skeleton")).toBeNull();
    expect(screen.getByTestId("markdown")).toHaveTextContent("**hello**");
  });

  it("shows a saved chat as plain text when the chunk fails, and renders it once a retry on `online` lands", async () => {
    let attempts = 0;
    chunk.load = () => (++attempts === 1 ? Promise.reject(new Error("ChunkLoadError")) : Promise.resolve(rendered));
    await mount((s) => s.seedChat(CHAT, "Saved", [row("m1", "user", "hi"), row("m2", "assistant", "**hello**")]));
    await flush();
    expect(screen.queryByTestId("thread-skeleton")).toBeNull();
    expect(screen.getByText("hi")).toBeInTheDocument();
    expect(screen.getByText("**hello**")).toBeInTheDocument();
    expect(screen.queryByTestId("markdown")).toBeNull();

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(attempts).toBe(2);
    expect(screen.getByTestId("markdown")).toHaveTextContent("**hello**");
  });

  it("keeps the first message of an empty chat on screen while the renderer is still loading", async () => {
    const load = deferred();
    chunk.load = () => load.promise.then(() => rendered);
    const { store, createMessageState } = await mount((s) => s.createChat(CHAT));
    await flush();
    expect(screen.getByText(/Ask anything/)).toBeInTheDocument();

    act(() => {
      store.addMessage(createMessageState({ id: "m1", chatId: CHAT, role: "user", blocks: [{ type: "text", text: "first question" }] }));
      store.addMessage(createMessageState({ id: "m2", chatId: CHAT, role: "assistant", status: "streaming", blocks: [{ type: "text", text: "Sure" }] }));
    });
    expect(screen.queryByTestId("thread-skeleton")).toBeNull();
    expect(screen.getByText("first question")).toBeInTheDocument();
    expect(screen.getByText("Sure")).toBeInTheDocument();

    await act(async () => load.resolve());
    expect(screen.getByTestId("markdown")).toHaveTextContent("Sure");
  });
});
