import type { StrategyFlowConfig, StrategyStepConfig } from "../types/blueprint";
import { getModuleContract } from "./module-contracts";
import { moduleSupportsStrategyEvent } from "./strategy-flow-events";
import { STRATEGY_EVENT_CONTRACTS } from "./strategy-events";

export { moduleSupportsStrategyEvent, firstEventForRole } from "./strategy-flow-events";
export {
  fourBrainToStrategyFlow,
  downstreamAnchorSteps,
  moduleStepId,
} from "./fourbrain-flow-adapter";

export interface StrategyFlowValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function validateStrategyFlowSchema(
  flow: StrategyFlowConfig | undefined,
): StrategyFlowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!flow) {
    return { ok: true, errors, warnings };
  }

  if (flow.version !== 1) errors.push("Strategy flow version must be 1.");
  if (!Array.isArray(flow.steps) || flow.steps.length === 0) {
    errors.push("Strategy flow must contain at least one step.");
  }

  const ids = new Set<string>();
  for (const step of flow.steps ?? []) {
    if (!step.id.trim()) errors.push("Every strategy step needs an id.");
    if (ids.has(step.id)) errors.push(`Duplicate strategy step id: ${step.id}.`);
    ids.add(step.id);

    if (!step.name.trim()) errors.push(`Step ${step.id} needs a name.`);
    if (!getModuleContract(step.module)) {
      warnings.push(`Step ${step.id} uses module ${step.module}, which has no contract yet.`);
    }
    if (!STRATEGY_EVENT_CONTRACTS[step.event]) {
      errors.push(`Step ${step.id} uses unknown event ${step.event}.`);
    } else if (
      getModuleContract(step.module) &&
      !moduleSupportsStrategyEvent(step.module, step.event)
    ) {
      errors.push(`Step ${step.id} uses ${step.event}, but ${step.module} does not expose it.`);
    }

    for (const dep of step.dependsOn ?? []) {
      if (!dep.stepId.trim()) errors.push(`Step ${step.id} has an empty dependency step id.`);
      if (dep.stepId === step.id) errors.push(`Step ${step.id} cannot depend on itself.`);
    }
  }

  for (const step of flow.steps ?? []) {
    for (const dep of step.dependsOn ?? []) {
      if (dep.stepId && !ids.has(dep.stepId)) {
        errors.push(`Step ${step.id} depends on missing step ${dep.stepId}.`);
      }
    }
    if (step.directionSource?.mode === "from_step" && step.directionSource.stepId) {
      if (!ids.has(step.directionSource.stepId)) {
        errors.push(
          `Step ${step.id} uses missing direction source ${step.directionSource.stepId}.`,
        );
      }
    }
    if (step.slSource?.stepId && !ids.has(step.slSource.stepId)) {
      errors.push(`Step ${step.id} uses missing SL source ${step.slSource.stepId}.`);
    }
  }

  const enabledSteps = (flow.steps ?? []).filter((step) => step.enabled !== false);
  if (!enabledSteps.some((step) => step.role === "entry")) {
    errors.push("Strategy flow needs at least one enabled entry step.");
  }

  return { ok: errors.length === 0, errors, warnings };
}
