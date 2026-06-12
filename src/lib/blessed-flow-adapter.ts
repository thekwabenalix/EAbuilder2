/**
 * Phase 4 — convert blessed deterministic adapters into StrategyFlow steps.
 *
 * Lets EMA+IFVG and EMA CTC compile through the ordered event engine instead of
 * the deprecated 4-Brain boolean assembler path.
 */

import type { AiBrainWiring } from "@/lib/api-client";
import type { FourBrainConfig, StrategyFlowConfig, StrategyStepConfig } from "@/types/blueprint";
import {
  detectBlessedAdapterId,
  extractEmaPeriods,
  extractEmaRetestTarget,
  extractSingleTimeframe,
  isBlessedAdapterWiring,
  type BlessedAdapterId,
} from "@/lib/blessed-ema-adapters";
import { flowEaSupportsAllSteps } from "@/generators/gen-flow-ea";
import { validateStrategyFlowSchema } from "@/lib/strategy-flow";

function numFrom(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function retestPointsFrom(text: string, config?: FourBrainConfig): number {
  const params = {
    ...(config?.setup?.params ?? {}),
    ...(config?.execution?.params ?? {}),
  };
  const configured = numFrom(params.retestPoints ?? params.tolerancePoints, NaN);
  return Number.isFinite(configured) ? configured : 5;
}

function repeatAfterConfirmation(text: string, config?: FourBrainConfig): boolean {
  const params = {
    ...(config?.setup?.params ?? {}),
    ...(config?.execution?.params ?? {}),
  };
  if (typeof params.repeatAfterConfirmation === "boolean") return params.repeatAfterConfirmation;
  const hay = text.toLowerCase();
  if (
    /\bdo not limit\b.{0,80}\b(?:first|one|single)\b/.test(hay) ||
    /\bdo not stop\b.{0,80}\b(?:looking|watching|monitoring)\b/.test(hay) ||
    /\bmultiple\b.{0,80}\b(?:trade|entry|test|retest)\b/.test(hay) ||
    /\bcontinue\b.{0,80}\b(?:watching|monitoring|looking)\b/.test(hay)
  ) {
    return true;
  }
  if (
    /\bonly the first\b.{0,100}\b(?:test|retest|trade|entry|setup)\b/.test(hay) ||
    /\b(?:one|single)\s+trade\s+per\s+cross\b/.test(hay)
  ) {
    return false;
  }
  return true;
}

function resolveBlessedKind(
  wiring: Pick<AiBrainWiring, "semantics" | "notes">,
  text: string,
  config?: FourBrainConfig,
): BlessedAdapterId | null {
  if (isBlessedAdapterWiring(wiring)) {
    const modules = wiring.semantics?.modules ?? [];
    if (modules.includes("fvg_inversion")) return "ema_ifvg";
    if (modules.includes("ema")) return "ema_ctc";
  }
  return detectBlessedAdapterId(text, config);
}

function buildEmaCtcFlow(text: string, config?: FourBrainConfig): StrategyFlowConfig {
  const tf = extractSingleTimeframe(text, config);
  const { fast, slow } = extractEmaPeriods(text, config);
  const retestPoints = retestPointsFrom(text, config);
  const repeat = repeatAfterConfirmation(text, config);
  const expiryBars = numFrom(config?.execution?.params?.expiryBars, 100);

  const steps: StrategyStepConfig[] = [
    {
      id: "step_direction",
      name: `${tf} EMA bias`,
      role: "direction",
      module: "ema",
      timeframe: tf,
      event: "EMA_BIAS",
      enabled: true,
      params: {
        fastPeriod: fast,
        slowPeriod: slow,
        retestPoints,
        requireCross: true,
        repeatAfterConfirmation: repeat,
      },
      directionSource: { mode: "own_event" },
    },
    {
      id: "step_setup",
      name: `${tf} EMA cross setup`,
      role: "setup",
      module: "ema",
      timeframe: tf,
      event: "EMA_CROSS",
      enabled: true,
      params: {
        fastPeriod: fast,
        slowPeriod: slow,
        retestPoints,
        requireCross: true,
        repeatAfterConfirmation: repeat,
      },
      dependsOn: [{ stepId: "step_direction", relation: "after", required: true }],
      directionSource: { mode: "from_step", stepId: "step_direction" },
    },
    {
      id: "step_entry",
      name: `${tf} EMA close confirm`,
      role: "entry",
      module: "ema",
      timeframe: tf,
      event: "EMA_CLOSE_CONFIRMED",
      enabled: true,
      params: {
        fastPeriod: fast,
        slowPeriod: slow,
        retestPoints,
        requireCross: true,
        repeatAfterConfirmation: repeat,
        expiryBars: 0,
      },
      dependsOn: [{ stepId: "step_setup", relation: "same_or_after", required: true }],
      directionSource: { mode: "from_step", stepId: "step_direction" },
      slSource: { mode: "event_sl", bufferPoints: 0 },
    },
  ];

  return {
    version: 1,
    mode: "simple_4brain",
    source: "blessed_adapter",
    steps,
    management: config?.management,
    notes: "Blessed EMA Cross-Test-Close sequence compiled as ordered Strategy Flow (Phase 4).",
  };
}

function buildEmaIfvgFlow(text: string, config?: FourBrainConfig): StrategyFlowConfig {
  const tf = extractSingleTimeframe(text, config);
  const { fast, slow } = extractEmaPeriods(text, config);
  const retestTarget = extractEmaRetestTarget(text, fast, slow, config);
  const retestPoints = retestPointsFrom(text, config);
  const expiryBars = numFrom(
    config?.setup?.params?.expiryBars ?? config?.execution?.params?.expiryBars,
    100,
  );

  const steps: StrategyStepConfig[] = [
    {
      id: "step_direction",
      name: `${tf} EMA cross`,
      role: "direction",
      module: "ema",
      timeframe: tf,
      event: "EMA_CROSS",
      enabled: true,
      params: { fastPeriod: fast, slowPeriod: slow, retestPoints },
      directionSource: { mode: "own_event" },
    },
    {
      id: "step_setup",
      name: `${tf} EMA retest`,
      role: "setup",
      module: "ema",
      timeframe: tf,
      event: "EMA_RETEST",
      enabled: true,
      params: { fastPeriod: fast, slowPeriod: slow, retestPoints, retestTarget },
      dependsOn: [{ stepId: "step_direction", relation: "after", required: true }],
      directionSource: { mode: "from_step", stepId: "step_direction" },
    },
    {
      id: "step_entry",
      name: `${tf} IFVG formation`,
      role: "entry",
      module: "fvg_inversion",
      timeframe: tf,
      event: "IFVG_FORMED",
      enabled: true,
      params: { expiryBars },
      dependsOn: [{ stepId: "step_setup", relation: "after", required: true }],
      directionSource: { mode: "from_step", stepId: "step_direction" },
      slSource: { mode: "event_sl", bufferPoints: 0 },
    },
  ];

  return {
    version: 1,
    mode: "simple_4brain",
    source: "blessed_adapter",
    steps,
    management: config?.management,
    notes:
      "Blessed EMA cross → retest → IFVG formation sequence compiled as ordered Strategy Flow (Phase 4).",
  };
}

/** Build StrategyFlow for a blessed adapter pattern when the flow engine can compile it. */
export function adaptBlessedWiringToFlow(
  wiring: Pick<AiBrainWiring, "semantics" | "notes">,
  text: string,
  config?: FourBrainConfig,
): StrategyFlowConfig | null {
  const kind = resolveBlessedKind(wiring, text, config);
  if (!kind) return null;

  const flow = kind === "ema_ctc" ? buildEmaCtcFlow(text, config) : buildEmaIfvgFlow(text, config);
  if (!flowEaSupportsAllSteps(flow)) return null;

  const validation = validateStrategyFlowSchema(flow);
  if (!validation.ok) return null;

  return flow;
}

export function blessedFlowSupportsAllSteps(
  wiring: Pick<AiBrainWiring, "semantics" | "notes">,
  text: string,
  config?: FourBrainConfig,
): boolean {
  return adaptBlessedWiringToFlow(wiring, text, config) !== null;
}
