/**
 * Phase 1 — single EA generation router.
 *
 * All blueprint → .mq5 paths go through here:
 *   1. Resolve StrategyFlow (explicit or 4-Brain adapter)
 *   2. Validate step schema (blueprint-generation-gate)
 *   3. Flow engine when all steps are supported (ordered event gate)
 *   4. Blueprint assembler fallback (verified SMs, boolean confluence)
 *   5. Legacy heuristic fallback for bb only
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import { configUsesLegacyHeuristics } from "@/generators/gen-blueprint-wiring";
import { generateEA } from "@/generators/gen-ea";
import type { MQL5CodeGenParams } from "@/types/blueprint";
import { flowEaSupportsAllSteps, generateFlowEA } from "@/generators/gen-flow-ea";
import type { StrategyFlowConfig } from "@/types/blueprint";
import {
  assertBlueprintGeneratable,
  EaGenerationError,
  resolveStrategyFlow,
} from "@/lib/blueprint-generation-gate";
import { BLUEPRINT_ASSEMBLER_DEPRECATION } from "@/lib/ea-generation-policy";

export type EaGenerationPath = "flow_engine" | "blueprint_assembler" | "legacy_heuristic";

export interface GenerateEaFromBlueprintResult {
  code: string;
  path: EaGenerationPath;
  flow?: StrategyFlowConfig;
  validationWarnings: string[];
}

export { EaGenerationError, resolveStrategyFlow } from "@/lib/blueprint-generation-gate";

export interface EaGenerationPreview {
  path: EaGenerationPath | null;
  validationErrors: string[];
  validationWarnings: string[];
}

function resolveGenerationPath(
  flow: StrategyFlowConfig,
  fourBrain: StrategyBlueprint["fourBrain"],
  gateWarnings: string[],
): Pick<EaGenerationPreview, "path" | "validationWarnings"> {
  if (flowEaSupportsAllSteps(flow)) {
    return { path: "flow_engine", validationWarnings: gateWarnings };
  }
  if (fourBrain && configUsesLegacyHeuristics(fourBrain)) {
    return {
      path: "legacy_heuristic",
      validationWarnings: [
        ...gateWarnings,
        "Flow engine does not cover all modules — using legacy heuristic brain generators.",
      ],
    };
  }
  return {
    path: "blueprint_assembler",
    validationWarnings: [...gateWarnings, BLUEPRINT_ASSEMBLER_DEPRECATION],
  };
}

/** Resolve compiler path + gate warnings without emitting MQL5 (for builder UI previews). */
export function previewEaGeneration(bp: StrategyBlueprint): EaGenerationPreview {
  try {
    const gate = assertBlueprintGeneratable(bp);
    const resolved = resolveGenerationPath(gate.flow!, bp.fourBrain, gate.warnings);
    return { ...resolved, validationErrors: [] };
  } catch (error) {
    if (error instanceof EaGenerationError) {
      return { path: null, validationErrors: [error.message], validationWarnings: [] };
    }
    throw error;
  }
}

function eaNameFromBlueprint(bp: StrategyBlueprint): string {
  return (bp.name || "Strategy_EA").replace(/[^\w\s-]/g, "").trim() || "Strategy_EA";
}

function generateBlueprintAssemblerEa(bp: StrategyBlueprint): string {
  const config = bp.fourBrain!;
  const params: MQL5CodeGenParams = {
    eaName: eaNameFromBlueprint(bp),
    config,
    globalSymbol: bp.execution?.symbol || "EURUSD",
    globalMagic: bp.execution?.magicNumber || 990001,
    filterRefs: bp.filterRefs,
  };
  return generateEA(params);
}

/**
 * Generate MQL5 for a 4-Brain / strategy-flow blueprint.
 * Throws EaGenerationError when validation fails.
 */
export function generateEaFromBlueprint(bp: StrategyBlueprint): GenerateEaFromBlueprintResult {
  const gate = assertBlueprintGeneratable(bp);
  const flow = gate.flow!;
  const eaName = eaNameFromBlueprint(bp);

  if (flowEaSupportsAllSteps(flow)) {
    return {
      code: generateFlowEA(flow, eaName, bp.filterRefs),
      path: "flow_engine",
      flow,
      validationWarnings: gate.warnings,
    };
  }

  const resolved = resolveGenerationPath(flow, bp.fourBrain, gate.warnings);
  return {
    code: generateBlueprintAssemblerEa(bp),
    path: resolved.path!,
    flow,
    validationWarnings: resolved.validationWarnings,
  };
}

/** User-facing label for generation path (toasts / audit). */
export function generationPathLabel(path: EaGenerationPath): string {
  switch (path) {
    case "flow_engine":
      return "Strategy Flow engine (ordered event gate)";
    case "blueprint_assembler":
      return "Blueprint assembler (verified state machines)";
    case "legacy_heuristic":
      return "Legacy heuristic fallback";
  }
}
