/**
 * Phase 6 — route AI wiring to Strategy Flow engine or legacy brain-body assembler.
 */

import type { AiBrainWiring } from "@/lib/api-client";
import {
  aiWiringHasStrategyFlow,
  mergeAiFlowIntoBlueprint,
} from "@/lib/ai-strategy-flow";
import {
  generateEaFromBlueprint,
  type GenerateEaFromBlueprintResult,
} from "@/lib/generate-ea-router";
import { generateEA } from "@/generators/gen-ea";
import type { StrategyBlueprint } from "@/types/blueprint";

export type AiGenerationMode = "strategy_flow" | "brain_bodies";

export interface GenerateEaFromAiWiringResult extends GenerateEaFromBlueprintResult {
  aiMode: AiGenerationMode;
}

function eaNameFromBlueprint(bp: StrategyBlueprint): string {
  return (bp.name || "Strategy_EA").replace(/[^\w\s-]/g, "").trim() || "Strategy_EA";
}

/**
 * Generate MQL5 from AI wiring.
 * - strategy_flow steps → blueprint.strategyFlow → generateEaFromBlueprint (flow engine)
 * - brain bodies → legacy generateEA({ aiWiring }) assembler path
 */
export function generateEaFromAiWiring(
  blueprint: StrategyBlueprint,
  wiring: AiBrainWiring,
): GenerateEaFromAiWiringResult {
  const config = blueprint.fourBrain!;
  const eaName = eaNameFromBlueprint(blueprint);

  if (aiWiringHasStrategyFlow(wiring)) {
    const bp = mergeAiFlowIntoBlueprint(blueprint, wiring);
    const result = generateEaFromBlueprint(bp);
    return { ...result, aiMode: "strategy_flow" };
  }

  const code = generateEA({
    eaName,
    config,
    globalSymbol: blueprint.execution?.symbol,
    globalMagic: blueprint.execution?.magicNumber,
    filterRefs: blueprint.filterRefs,
    aiWiring: wiring,
  });

  return {
    code,
    path: "blueprint_assembler",
    validationWarnings: wiring.validation?.warnings ?? [],
    aiMode: "brain_bodies",
  };
}
