import path from "node:path";
import { AnthropicProvider } from "./providers/anthropic";
import { RecordingProvider } from "./providers/recording";
import { ReplayProvider } from "./providers/replay";
import { ScriptedProvider } from "./providers/scripted";
import type { Provider, ProviderRequest } from "./providers/types";
import { demoFixture, isScenarioName, scenarioScript } from "./scenarios";
import type { ProviderContext, ProviderResolver } from "./engine";

export interface RegistryOptions {
  replayMode: boolean;
  record: boolean;
  fixturesDir?: string;
  /** Speed multiplier for replay and scripted providers (tests use a large value). */
  speed?: number;
  anthropic?: AnthropicProvider;
}

/**
 * D24: chooses the provider per request, server-side, so the scenario panel
 * can never spend API money or bypass caps. Demo users always get replay or
 * scripted; scenario requests always get scripted; everything else gets the
 * live API unless the process booted in replay mode.
 */
export function createProviderResolver(options: RegistryOptions): ProviderResolver {
  const fixturesDir = options.fixturesDir ?? path.resolve(process.cwd(), "fixtures");
  const speed = options.speed ?? 1;
  const scripted = new ScriptedProvider((request: ProviderRequest) => {
    const name = isScenarioName(request.scenario) ? request.scenario : "normal";
    return scenarioScript(name, request);
  }, speed);
  const replay = new ReplayProvider({
    fixturesDir,
    fixture: (request) => demoFixture(request.model, turnOf(request)),
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
    if (ctx.userRole === "demo" || options.replayMode) return replay;
    return liveProvider();
  };
}

function turnOf(request: ProviderRequest): number {
  let n = 0;
  for (const m of request.messages) if (m.role === "assistant") n++;
  return n;
}
