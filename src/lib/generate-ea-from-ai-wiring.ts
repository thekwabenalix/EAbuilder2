/**
 * Phase 6 + Phase 4 — route AI wiring to Strategy Flow engine, blessed flow, or legacy assembler.
 */

import type { AiBrainWiring } from "@/lib/api-client";
import { aiWiringHasStrategyFlow, mergeAiFlowIntoBlueprint } from "@/lib/ai-strategy-flow";
import { adaptBlessedWiringToFlow } from "@/lib/blessed-flow-adapter";
import { BLUEPRINT_ASSEMBLER_DEPRECATION } from "@/lib/ea-generation-policy";
import {
  generateEaFromBlueprint,
  type GenerateEaFromBlueprintResult,
} from "@/lib/generate-ea-router";
import { generateEA } from "@/generators/gen-ea";
import { resolveAiWiring, type ResolvedAiMode } from "@/lib/resolve-ai-wiring";
import type { StrategyBlueprint } from "@/types/blueprint";

export type AiGenerationMode = ResolvedAiMode | "blessed_flow";

export interface GenerateEaFromAiWiringResult extends GenerateEaFromBlueprintResult {
  aiMode: AiGenerationMode;
  aiWarnings: string[];
}

function eaNameFromBlueprint(bp: StrategyBlueprint): string {
  return (bp.name || "Strategy_EA").replace(/[^\w\s-]/g, "").trim() || "Strategy_EA";
}

function strategyTextFromBlueprint(blueprint: StrategyBlueprint): string {
  const fb = blueprint.fourBrain;
  return [fb?.direction?.description, fb?.setup?.description, fb?.execution?.description]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generate MQL5 from AI wiring.
 * - strategy_flow steps → flow engine
 * - blessed adapter → Strategy Flow when adaptBlessedWiringToFlow succeeds
 * - legacy brain bodies → deprecated assembler path
 */
export function generateEaFromAiWiring(
  blueprint: StrategyBlueprint,
  wiring: AiBrainWiring,
): GenerateEaFromAiWiringResult {
  const config = blueprint.fourBrain!;
  const eaName = eaNameFromBlueprint(blueprint);
  const text = strategyTextFromBlueprint(blueprint);

  const resolved = resolveAiWiring({ wiring, text, config, filterRefs: blueprint.filterRefs });
  const activeWiring = resolved.wiring;

  if (aiWiringHasStrategyFlow(activeWiring)) {
    const bp = mergeAiFlowIntoBlueprint(blueprint, activeWiring);
    const result = generateEaFromBlueprint(bp);
    return { ...result, aiMode: "strategy_flow", aiWarnings: resolved.warnings };
  }

  const blessedFlow = adaptBlessedWiringToFlow(activeWiring, text, config);
  if (blessedFlow) {
    const bp: StrategyBlueprint = { ...blueprint, strategyFlow: blessedFlow };
    const result = generateEaFromBlueprint(bp);
    return { ...result, aiMode: "blessed_flow", aiWarnings: resolved.warnings };
  }

  const validationWarnings = [
    ...resolved.warnings,
    ...(activeWiring.validation?.warnings ?? []),
    BLUEPRINT_ASSEMBLER_DEPRECATION,
  ];

  const code = generateEA({
    eaName,
    config,
    globalSymbol: blueprint.execution?.symbol,
    globalMagic: blueprint.execution?.magicNumber,
    filterRefs: blueprint.filterRefs,
    aiWiring: activeWiring,
  });

  return {
    code,
    path: "blueprint_assembler",
    validationWarnings,
    aiMode: resolved.mode === "blessed_adapter" ? "blessed_adapter" : "brain_bodies",
    aiWarnings: resolved.warnings,
  };
}
