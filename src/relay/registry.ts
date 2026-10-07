import path from "node:path";
import { AnthropicProvider } from "./providers/anthropic";
import { RecordingProvider } from "./providers/recording";
import { ReplayProvider } from "./providers/replay";
import { ScriptedProvider } from "./providers/scripted";
import type { Provider, ProviderRequest } from "./providers/types";
import { isScenarioName, replayFixture, scenarioScript } from "./scenarios";
import type { ProviderContext, ProviderResolver } from "./engine";

export interface RegistryOptions {
  replayMode: boolean;
  record: boolean;
  fixturesDir?: string;
  /** Speed multiplier for replay and scripted providers (tests use a large value). */
  speed?: number;
  anthropic?: AnthropicProvider;
}

// Provider choice is server-side so the panel cannot spend money or bypass caps (D24):
// scenarios get scripted, replay mode gets replay, everything else goes live.
export function createProviderResolver(options: RegistryOptions): ProviderResolver {
  const fixturesDir = options.fixturesDir ?? path.resolve(process.cwd(), "fixtures");
  const speed = options.speed ?? 1;
  const scripted = new ScriptedProvider((request: ProviderRequest) => {
    const name = isScenarioName(request.scenario) ? request.scenario : "normal";
    return scenarioScript(name, request);
  }, speed);
  const replay = new ReplayProvider({
    fixturesDir,
    fixture: (request) => replayFixture(request.model, turnOf(request)),
    speed,
  });
  let live: Provider | null = null;
  const liveProvider = (): Provider => {
    if (!live) {
      const base = options.anthropic ?? new AnthropicProvider();
      live = options.record ? new RecordingProvider(base, path.join(fixturesDir, "recorded")) : base;
    }
    return live;
  };
  return (ctx: ProviderContext): Provider => {
    if (ctx.scenario) return scripted;
    if (options.replayMode) return replay;
    return liveProvider();
  };
}

function turnOf(request: ProviderRequest): number {
  let n = 0;
  for (const m of request.messages) if (m.role === "assistant") n++;
  return n;
}
