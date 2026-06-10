/**
 * Phase 7 — Strategy Flow Builder UI helpers.
 *
 * Converts between 4-Brain presets and user-authored advanced step chains.
 */

import type {
  FourBrainConfig,
  StrategyBlueprint,
  StrategyFlowConfig,
  StrategyStepConfig,
  StrategyStepRole,
} from "@/types/blueprint";
import { fourBrainToStrategyFlow } from "@/lib/fourbrain-flow-adapter";
import { firstEventForRole } from "@/lib/strategy-flow-events";
import { flowEaSupportsAllSteps } from "@/generators/gen-flow-ea";
import { validateStrategyFlowSchema } from "@/lib/strategy-flow";

export type BuilderFlowMode = "simple" | "advanced";

export const STEP_ROLE_OPTIONS: Array<{ value: StrategyStepRole; label: string }> = [
  { value: "direction", label: "Direction" },
  { value: "setup", label: "Setup" },
  { value: "entry", label: "Entry" },
  { value: "confirmation", label: "Confirmation" },
  { value: "filter", label: "Filter" },
];

/** True when the blueprint has user-authored advanced flow steps. */
export function blueprintUsesAdvancedFlow(bp: StrategyBlueprint): boolean {
  return (
    bp.strategyFlow?.mode === "advanced_instances" &&
    bp.strategyFlow.source === "user" &&
    (bp.strategyFlow.steps?.length ?? 0) > 0
  );
}

export function builderModeFromBlueprint(bp: StrategyBlueprint): BuilderFlowMode {
  return blueprintUsesAdvancedFlow(bp) ? "advanced" : "simple";
}

/** Seed advanced editor from explicit flow or 4-Brain adapter. */
export function seedAdvancedFlow(
  bp: StrategyBlueprint,
  fourBrain?: FourBrainConfig,
): StrategyFlowConfig {
  if (blueprintUsesAdvancedFlow(bp) && bp.strategyFlow) {
    return { ...bp.strategyFlow };
  }
  const cfg = fourBrain ?? bp.fourBrain;
  if (cfg) {
    const adapted = fourBrainToStrategyFlow(cfg);
    return {
      ...adapted,
      mode: "advanced_instances",
      source: "user",
    };
  }
  return {
    version: 1,
    mode: "advanced_instances",
    source: "user",
    steps: [],
  };
}

export function newStepId(steps: StrategyStepConfig[], role: StrategyStepRole): string {
  const slug =
    role === "direction"
      ? "direction"
      : role === "setup"
        ? "setup"
        : role === "entry" || role === "confirmation"
          ? "entry"
          : role;
  let index = 0;
  let id = `step_${slug}`;
  while (steps.some((step) => step.id === id)) {
    index += 1;
    id = `step_${slug}_${index}`;
  }
  return id;
}

export function defaultStepName(moduleId: string, timeframe: string, role: StrategyStepRole): string {
  const roleLabel = STEP_ROLE_OPTIONS.find((r) => r.value === role)?.label ?? role;
  return `${roleLabel} ${moduleId.replace(/_/g, " ").toUpperCase()} ${timeframe}`;
}

/** Create a new step chained after the last step. */
export function createDefaultStep(
  steps: StrategyStepConfig[],
  role: StrategyStepRole = "entry",
): StrategyStepConfig {
  const moduleId = "bos";
  const timeframe = steps[steps.length - 1]?.timeframe ?? "M5";
  const prior = steps[steps.length - 1];
  const id = newStepId(steps, role);
  const event =
    firstEventForRole(moduleId, role) ??
    firstEventForRole(moduleId, "entry") ??
    "BOS_CONFIRMED";

  return {
    id,
    name: defaultStepName(moduleId, timeframe, role),
    role,
    module: moduleId,
    timeframe,
    event,
    enabled: true,
    params: {},
    dependsOn: prior
      ? [{ stepId: prior.id, relation: "after", required: true }]
      : undefined,
    directionSource:
      role === "direction"
        ? { mode: "own_event" }
        : steps.find((s) => s.role === "direction")
          ? { mode: "from_step", stepId: steps.find((s) => s.role === "direction")!.id }
          : { mode: "own_event" },
  };
}

/** Keep a linear after-chain when the user has not set custom dependencies. */
export function syncLinearDependencies(steps: StrategyStepConfig[]): StrategyStepConfig[] {
  return steps.map((step, index) => {
    if (index === 0) {
      return { ...step, dependsOn: undefined };
    }
    const prev = steps[index - 1]!;
    if (step.dependsOn?.length) return step;
    return {
      ...step,
      dependsOn: [{ stepId: prev.id, relation: "after", required: true }],
    };
  });
}

export function reorderSteps(
  steps: StrategyStepConfig[],
  fromIndex: number,
  toIndex: number,
): StrategyStepConfig[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return steps;
  if (fromIndex >= steps.length || toIndex >= steps.length) return steps;
  const next = [...steps];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved!);
  return syncLinearDependencies(next);
}

export function removeStepAt(steps: StrategyStepConfig[], index: number): StrategyStepConfig[] {
  const removed = steps[index];
  if (!removed) return steps;
  const next = steps.filter((_, i) => i !== index);
  return syncLinearDependencies(
    next.map((step) => ({
      ...step,
      dependsOn: step.dependsOn?.filter((dep) => dep.stepId !== removed.id),
      directionSource:
        step.directionSource?.stepId === removed.id
          ? { mode: "own_event" as const }
          : step.directionSource,
    })),
  );
}

export function attachUserFlowToBlueprint(
  bp: StrategyBlueprint,
  flow: StrategyFlowConfig,
): StrategyBlueprint {
  const steps = syncLinearDependencies(flow.steps ?? []);
  return {
    ...bp,
    strategyFlow: {
      version: 1,
      mode: "advanced_instances",
      source: "user",
      steps,
      management: flow.management ?? bp.fourBrain?.management,
      notes: flow.notes,
    },
  };
}

export function detachAdvancedFlow(bp: StrategyBlueprint): StrategyBlueprint {
  const { strategyFlow: _removed, ...rest } = bp;
  return rest;
}

export function nameFromFlowSteps(steps: StrategyStepConfig[]): string {
  const enabled = steps.filter((step) => step.enabled !== false);
  if (!enabled.length) return "Strategy Flow";
  return enabled
    .map((step) => `${step.timeframe} ${step.module.replace(/_/g, " ").toUpperCase()}`)
    .join(" → ");
}

export interface FlowBuilderValidation {
  schemaOk: boolean;
  flowEngineOk: boolean;
  errors: string[];
  warnings: string[];
}

export function validateFlowForBuilder(flow: StrategyFlowConfig): FlowBuilderValidation {
  const schema = validateStrategyFlowSchema(flow);
  const flowEngineOk = schema.ok ? flowEaSupportsAllSteps(flow) : false;
  const warnings = [...schema.warnings];
  if (schema.ok && !flowEngineOk) {
    warnings.push(
      "Some steps use modules the Strategy Flow engine does not cover yet — generation will fall back to the blueprint assembler.",
    );
  }
  return {
    schemaOk: schema.ok,
    flowEngineOk,
    errors: schema.errors,
    warnings,
  };
}
