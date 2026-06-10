/**
 * Phase 1 — single EA generation router.
 *
 * All blueprint → .mq5 paths go through here:
 *   1. Resolve StrategyFlow (explicit or 4-Brain adapter)
 *   2. Validate step schema
 *   3. Flow engine when all steps are supported (ordered event gate)
 *   4. Blueprint assembler fallback (verified SMs, boolean confluence)
 *   5. Legacy heuristic fallback for pin_bar / bb / swing_structure only
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import { configUsesLegacyHeuristics } from "@/generators/gen-blueprint-wiring";
import { generateEA } from "@/generators/gen-ea";
import type { MQL5CodeGenParams } from "@/types/blueprint";
import {
  flowEaSupportsAllSteps,
  generateFlowEA,
} from "@/generators/gen-flow-ea";
import {
  fourBrainToStrategyFlow,
  validateStrategyFlowSchema,
} from "@/lib/strategy-flow";
import type { StrategyFlowConfig } from "@/types/blueprint";

export type EaGenerationPath = "flow_engine" | "blueprint_assembler" | "legacy_heuristic";

export interface GenerateEaFromBlueprintResult {
  code: string;
  path: EaGenerationPath;
  flow?: StrategyFlowConfig;
  validationWarnings: string[];
}

export class EaGenerationError extends Error {
  validationErrors: string[];

  constructor(message: string, validationErrors: string[] = []) {
    super(message);
    this.name = "EaGenerationError";
    this.validationErrors = validationErrors;
  }
}

function eaNameFromBlueprint(bp: StrategyBlueprint): string {
  return (bp.name || "Strategy_EA").replace(/[^\w\s-]/g, "").trim() || "Strategy_EA";
}

/** Resolve ordered steps from explicit strategyFlow or 4-Brain adapter. */
export function resolveStrategyFlow(bp: StrategyBlueprint): StrategyFlowConfig | null {
  if (bp.strategyFlow?.steps?.length) {
    return {
      ...bp.strategyFlow,
      management: bp.strategyFlow.management ?? bp.fourBrain?.management,
    };
  }
  if (bp.fourBrain) return fourBrainToStrategyFlow(bp.fourBrain);
  return null;
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
 * Throws EaGenerationError when step validation fails.
 */
export function generateEaFromBlueprint(bp: StrategyBlueprint): GenerateEaFromBlueprintResult {
  if (!bp.fourBrain) {
    throw new EaGenerationError("4-Brain configuration is required for assembler generation.");
  }

  const flow = resolveStrategyFlow(bp);
  if (!flow) {
    throw new EaGenerationError("Could not resolve strategy flow from blueprint.");
  }

  const validation = validateStrategyFlowSchema(flow);
  if (!validation.ok) {
    throw new EaGenerationError(
      `Strategy flow validation failed:\n${validation.errors.join("\n")}`,
      validation.errors,
    );
  }

  const eaName = eaNameFromBlueprint(bp);

  if (flowEaSupportsAllSteps(flow)) {
    return {
      code: generateFlowEA(flow, eaName),
      path: "flow_engine",
      flow,
      validationWarnings: validation.warnings,
    };
  }

  if (configUsesLegacyHeuristics(bp.fourBrain)) {
    return {
      code: generateBlueprintAssemblerEa(bp),
      path: "legacy_heuristic",
      flow,
      validationWarnings: [
        ...validation.warnings,
        "Flow engine does not cover all modules — using legacy heuristic brain generators.",
      ],
    };
  }

  return {
    code: generateBlueprintAssemblerEa(bp),
    path: "blueprint_assembler",
    flow,
    validationWarnings: validation.warnings,
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
