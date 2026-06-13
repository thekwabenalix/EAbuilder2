/**
 * Deterministic adapter: SMC zone setup + SNR rejection execution → strategy_flow
 * with zone-scoped confirm + BAR_AFTER_CONFIRM (never REJSM on unrelated levels).
 */

import type { AiBrainWiring } from "@/lib/api-client";
import {
  fourBrainToStrategyFlow,
  fourBrainUsesZoneScopedRejection,
  normalizeMisplacedModules,
} from "@/lib/fourbrain-flow-adapter";
import { extractSingleTimeframe } from "@/lib/blessed-ema-adapters";
import {
  repairZoneScopedRejectionConfig,
  resolveZoneModuleFromCorpus,
  wantsZoneRejectionRemap,
} from "@/lib/zone-scoped-rejection-repair";
import type { BrainModuleType, FourBrainConfig, StrategyStepConfig } from "@/types/blueprint";

function inferMinimalFourBrainForZoneRejection(text: string): FourBrainConfig | undefined {
  const zoneMod = resolveZoneModuleFromCorpus(text);
  if (!zoneMod || !wantsZoneRejectionRemap(text)) return undefined;
  const tf = extractSingleTimeframe(text) ?? "H1";
  return {
    setup: { modules: [zoneMod], timeframe: tf, params: {} },
    execution: { modules: ["rejection"], timeframe: tf, params: {} },
  };
}

function effectiveConfig(text: string, config?: FourBrainConfig): FourBrainConfig | undefined {
  if (config?.execution?.modules?.length) {
    return repairZoneScopedRejectionConfig(config, text);
  }
  return inferMinimalFourBrainForZoneRejection(text);
}

export function isZoneScopedRejectionStrategy(text: string, config?: FourBrainConfig): boolean {
  const cfg = effectiveConfig(text, config);
  if (!cfg) return false;
  return fourBrainUsesZoneScopedRejection(normalizeMisplacedModules(cfg));
}

function flowStepToAiStep(step: StrategyStepConfig) {
  return {
    id: step.id,
    name: step.name,
    role: step.role,
    module: step.module,
    timeframe: step.timeframe,
    event: step.event,
    enabled: step.enabled,
    params: step.params,
    dependsOn: step.dependsOn,
    directionSource: step.directionSource,
    slSource: step.slSource,
    notes: step.notes,
  };
}

function modulesFromFlow(config: FourBrainConfig, zoneMod: BrainModuleType): string[] {
  const mods = new Set<string>();
  if (config.direction?.modules?.length) {
    for (const m of config.direction.modules) mods.add(m);
  }
  mods.add(zoneMod);
  return [...mods];
}

export function buildZoneScopedRejectionStrategyFlowWiring(
  text: string,
  config?: FourBrainConfig,
): AiBrainWiring {
  const cfg = effectiveConfig(text, config);
  if (!cfg) {
    throw new Error("buildZoneScopedRejectionStrategyFlowWiring: not a zone-scoped rejection strategy");
  }

  const normalized = normalizeMisplacedModules(cfg);
  const flow = fourBrainToStrategyFlow(normalized);
  const zoneMod =
    normalized.setup?.modules?.[0] ??
    resolveZoneModuleFromCorpus(text) ??
    ("unicorn" as BrainModuleType);
  const tf = normalized.execution.timeframe ?? extractSingleTimeframe(text, config) ?? "H1";

  return {
    output_mode: "strategy_flow",
    strategy_flow: {
      version: 1,
      steps: flow.steps.map(flowStepToAiStep),
      notes: flow.notes,
    },
    direction_brain: "",
    setup_brain: "",
    execution_brain: "",
    semantics: {
      version: 1,
      source: "deterministic_adapter",
      timeframe: tf,
      modules: modulesFromFlow(normalized, zoneMod),
      setup: {
        gate: zoneMod === "unicorn" ? "overlap_active" : "active_zone",
        mustOccurAfter: normalized.direction ? "direction_event" : undefined,
      },
      execution: {
        module: zoneMod,
        entryEvent: "zone_rejection",
        mustOccurAfter: "setup_gate",
      },
      assumptions: [
        "Deterministic adapter: zone-scoped SMC rejection on the setup zone (not SNR REJSM).",
      ],
    },
    required_sms: [],
    sm_configs: {},
    notes: `Deterministic adapter: ${flow.notes ?? "zone-scoped rejection strategy_flow"}`,
  };
}

export function aiResponseNeedsZoneRejectionOverride(
  response: Pick<
    AiBrainWiring,
    "output_mode" | "strategy_flow" | "direction_brain" | "setup_brain" | "execution_brain"
  >,
): boolean {
  const code = `${response.direction_brain ?? ""}${response.setup_brain ?? ""}${response.execution_brain ?? ""}`;
  if (/REJSM_/.test(code)) return true;
  const steps = response.strategy_flow?.steps ?? [];
  if (steps.some((s) => s.module === "rejection")) return true;
  if (response.output_mode !== "strategy_flow" || steps.length === 0) return true;
  return false;
}

export function applyZoneScopedRejectionFlowOverride(
  response: AiBrainWiring,
  text: string,
  config?: FourBrainConfig,
): AiBrainWiring {
  if (!isZoneScopedRejectionStrategy(text, config)) return response;
  if (!aiResponseNeedsZoneRejectionOverride(response)) return response;

  const wiring = buildZoneScopedRejectionStrategyFlowWiring(text, config);
  return {
    ...response,
    output_mode: "strategy_flow",
    strategy_flow: wiring.strategy_flow,
    direction_brain: "",
    setup_brain: "",
    execution_brain: "",
    sm_configs: {},
    required_sms: [],
    semantics: wiring.semantics,
    notes: `${response.notes ? `${response.notes}\n\n` : ""}${wiring.notes}`,
  };
}
