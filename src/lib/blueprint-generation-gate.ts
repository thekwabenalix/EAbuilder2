/**
 * Phase 5 — validator gates all 4-Brain / strategy-flow generation.
 *
 * Every generate path must pass validateBlueprintForGeneration() before emitting MQL5.
 */

import type { StrategyBlueprint, StrategyFlowConfig } from "@/types/blueprint";
import { blueprintContractErrors, firstBlueprintContractError } from "@/lib/blueprint-explanation";
import { fourBrainToStrategyFlow, validateStrategyFlowSchema } from "@/lib/strategy-flow";
import { LEGACY_FLAT_RULES_MESSAGE } from "@/lib/ea-generation-policy";

export interface BlueprintGenerationGateResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  flow?: StrategyFlowConfig;
}

export class EaGenerationError extends Error {
  validationErrors: string[];

  constructor(message: string, validationErrors: string[] = []) {
    super(message);
    this.name = "EaGenerationError";
    this.validationErrors = validationErrors;
  }
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

/** Full preflight: blueprint contract + strategy flow schema. */
export function validateBlueprintForGeneration(
  bp: StrategyBlueprint,
): BlueprintGenerationGateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!bp.fourBrain) {
    errors.push(LEGACY_FLAT_RULES_MESSAGE);
    return { ok: false, errors, warnings };
  }

  const exec = bp.fourBrain.execution;
  if (!exec?.modules?.length || !exec.timeframe) {
    errors.push("Execution Brain needs at least one module and a timeframe.");
  }

  for (const msg of blueprintContractErrors(bp)) {
    if (!errors.includes(msg)) errors.push(msg);
  }

  const contractFirst = firstBlueprintContractError(bp);
  if (contractFirst && !errors.includes(contractFirst)) {
    errors.push(contractFirst);
  }

  let flow: StrategyFlowConfig | undefined;
  if (errors.length === 0) {
    const resolved = resolveStrategyFlow(bp);
    if (!resolved) {
      errors.push("Could not resolve strategy flow from blueprint.");
    } else {
      flow = resolved;
      const flowValidation = validateStrategyFlowSchema(flow);
      for (const err of flowValidation.errors) {
        if (!errors.includes(err)) errors.push(err);
      }
      for (const warn of flowValidation.warnings) {
        if (!warnings.includes(warn)) warnings.push(warn);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings, flow };
}

export function firstBlueprintGenerationError(bp: StrategyBlueprint): string | undefined {
  return validateBlueprintForGeneration(bp).errors[0];
}

/** Stricter than execution-only check — includes flow schema validation. */
export function blueprintReadyForGeneration(bp: StrategyBlueprint): boolean {
  return validateBlueprintForGeneration(bp).ok;
}

/** Throws EaGenerationError when generation must be blocked. */
export function assertBlueprintGeneratable(bp: StrategyBlueprint): BlueprintGenerationGateResult {
  const result = validateBlueprintForGeneration(bp);
  if (!result.ok) {
    throw new EaGenerationError(
      result.errors.length === 1
        ? result.errors[0]
        : `Generation blocked:\n${result.errors.join("\n")}`,
      result.errors,
    );
  }
  return result;
}

export function formatGenerationGateErrors(errors: string[]): string {
  return errors.length === 1 ? errors[0] : errors.join("\n");
}
