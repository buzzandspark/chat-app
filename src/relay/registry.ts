import { AnthropicProvider } from "./providers/anthropic";
import { ScriptedProvider } from "./providers/scripted";
import type { Provider, ProviderRequest } from "./providers/types";
import { isScenarioName, replayScenario, scenarioScript } from "./scenarios";
import type { ProviderContext, ProviderResolver } from "./engine";

// Provider choice is server-side so the panel cannot spend money or bypass caps:
// scenarios and replay mode get scripted, everything else goes live.
export function createProviderResolver({ replayMode }: { replayMode: boolean }): ProviderResolver {
  const scripted = new ScriptedProvider((request: ProviderRequest) => {
    const name = isScenarioName(request.scenario) ? request.scenario : "normal";
    return scenarioScript(name, request);
  });
  const replay = new ScriptedProvider(
    (request) => scenarioScript(replayScenario(request), request),
    1,
    (request) => [...`${request.model}/${replayScenario(request)}`].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7),
  );
  let live: Provider | null = null;
  return (ctx: ProviderContext): Provider => {
    if (ctx.scenario) return scripted;
    if (replayMode) return replay;
    live ??= new AnthropicProvider();
    return live;
  };
}
