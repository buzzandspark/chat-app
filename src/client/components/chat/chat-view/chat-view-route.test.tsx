import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useContext } from "react";
import { createMessageState, type ChatStore } from "@client/store/chat-store";
import { ChatStoreProvider, useChatStore } from "@client/store/context";
import { ModalProvider } from "../../ui/modal-manager";
import { ShellUserProvider } from "../../shell/shell-user";
import { ChatActionsContext, ChatLiveStateContext, type ChatActions, type ChatLiveState } from "../chat-context";
import { ChatView } from ".";

const A = "0199a000-0000-7000-8000-00000000000a";
const B = "0199a000-0000-7000-8000-00000000000b";

const nav = vi.hoisted(() => ({ params: {} as { id?: string }, pathname: "/c", search: new URLSearchParams() }));
vi.mock("next/navigation", () => ({
  useParams: () => nav.params,
  usePathname: () => nav.pathname,
  useSearchParams: () => nav.search,
  useRouter: () => ({ push: () => {}, prefetch: () => {}, refresh: () => {} }),
}));
vi.mock("@client/hooks/use-new-chat", () => ({ useNewChat: () => () => {} }));
vi.mock("@client/transport/generation-client", () => ({ getGenerationClient: () => ({ send: () => {}, attach: () => {} }) }));
vi.mock("../composer", () => ({ Composer: () => null }));

interface Seen {
  actions: ChatActions | null;
  live: ChatLiveState | null;
  store: ChatStore | null;
}
const seen: Seen = { actions: null, live: null, store: null };
const record = (value: Seen) => Object.assign(seen, value);
function Probe({ onRender }: { onRender: (value: Seen) => void }) {
  onRender({ store: useChatStore(), actions: useContext(ChatActionsContext), live: useContext(ChatLiveStateContext) });
  return null;
}

const tree = () => (
  <ChatStoreProvider>
    <ModalProvider>
      <ShellUserProvider userId="u1" guest={false} scenarioPanel={false} exploreOptions={false}>
        <ChatView>
          <Probe onRender={record} />
        </ChatView>
      </ShellUserProvider>
    </ModalProvider>
  </ChatStoreProvider>
);

function go(pathname: string, n: string | null) {
  nav.pathname = pathname;
  nav.search = new URLSearchParams(n ? { n } : {});
}

describe("the kept /c view", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    nav.params = {};
    go("/c", A);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("follows Back to a chat it renamed to /c/<id>", () => {
    const { rerender } = render(tree());
    expect(seen.actions?.chatId).toBe(A);
    // The first send renames the entry to /c/A; New chat then pushes /c?n=B.
    go(`/c/${A}`, null);
    rerender(tree());
    expect(seen.actions?.chatId).toBe(A);
    go("/c", B);
    rerender(tree());
    expect(seen.actions?.chatId).toBe(B);
    // Back restores /c/A into the same view.
    go(`/c/${A}`, null);
    rerender(tree());
    expect(seen.actions?.chatId).toBe(A);
  });

  it("does not carry an open edit into the next New chat", () => {
    const { rerender } = render(tree());
    act(() => {
      seen.store?.addMessage(createMessageState({ id: "u1", chatId: A, role: "user", blocks: [{ type: "text", text: "hi" }] }));
      seen.actions?.editMessage("u1");
    });
    expect(seen.live?.editing).toEqual({ userMessageId: "u1", text: "hi" });
    go("/c", B);
    rerender(tree());
    expect(seen.actions?.chatId).toBe(B);
    expect(seen.live?.editing).toBeNull();
  });

  it("ignores the active chat route's id while hidden behind it", () => {
    const { rerender } = render(tree());
    nav.params = { id: B };
    go(`/c/${B}`, null);
    rerender(tree());
    expect(seen.actions?.chatId).toBe(A);
  });
});
