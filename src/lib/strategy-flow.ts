import type {
  BrainConfig,
  FourBrainConfig,
  StrategyFlowConfig,
  StrategyStepConfig,
  StrategyStepRole,
} from "../types/blueprint";
import { getModuleContract } from "./module-contracts";
import type { BrainRole } from "./module-contracts";
import {
  MODULE_SEMANTIC_EVENT_TYPES,
  STRATEGY_EVENT_CONTRACTS,
  type StrategyEventType,
} from "./strategy-events";

export interface StrategyFlowValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function moduleSupportsStrategyEvent(
  moduleId: string,
  eventType: StrategyEventType,
): boolean {
  return Object.values(MODULE_SEMANTIC_EVENT_TYPES[moduleId] ?? {}).includes(eventType);
}

function contractRolesForStepRole(role: StrategyStepRole): BrainRole[] {
  if (role === "entry" || role === "confirmation") return ["execution"];
  if (role === "filter") return ["setup", "execution"];
  if (role === "context" || role === "risk") return ["direction", "setup", "execution"];
  return [role];
}

function firstEventForRole(
  moduleId: string,
  role: StrategyStepRole,
): StrategyEventType | undefined {
  const contract = getModuleContract(moduleId);
  if (!contract) return undefined;
  const roles = contractRolesForStepRole(role);
  for (const semanticEvent of contract.semanticEvents) {
    if (!semanticEvent.roles.some((eventRole) => roles.includes(eventRole))) continue;
    const eventType = MODULE_SEMANTIC_EVENT_TYPES[moduleId]?.[semanticEvent.id];
    if (eventType) return eventType;
  }
  return undefined;
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

function stepFromBrain(
  id: string,
  name: string,
  role: StrategyStepRole,
  brain: BrainConfig,
  dependsOn?: StrategyStepConfig[],
): StrategyStepConfig {
  const moduleId = brain.modules[0] ?? "custom";
  const event = firstEventForRole(moduleId, role) ?? firstEventForRole(moduleId, "entry");
  return {
    id,
    name,
    role,
    module: moduleId,
    timeframe: brain.timeframe,
    event: event ?? "BOS_CONFIRMED",
    enabled: true,
    params: brain.params,
    dependsOn: dependsOn?.map((step) => ({
      stepId: step.id,
      relation: "after",
      required: true,
    })),
    directionSource:
      role === "direction"
        ? { mode: "own_event" }
        : dependsOn?.[0]
          ? { mode: "from_step", stepId: dependsOn[0].id }
          : { mode: "own_event" },
    slSource:
      role === "entry"
        ? { mode: "event_sl", bufferPoints: 0 }
        : { mode: "event_sl", bufferPoints: 0 },
    notes: brain.description,
  };
}

export function fourBrainToStrategyFlow(config: FourBrainConfig): StrategyFlowConfig {
  const steps: StrategyStepConfig[] = [];
  const directionStep = config.direction
    ? stepFromBrain("step_direction", "Direction", "direction", config.direction)
    : undefined;
  if (directionStep) steps.push(directionStep);

  const setupStep = config.setup
    ? stepFromBrain(
        "step_setup",
        "Setup",
        "setup",
        config.setup,
        directionStep ? [directionStep] : undefined,
      )
    : undefined;
  if (setupStep) steps.push(setupStep);

  const executionDeps = setupStep ? [setupStep] : directionStep ? [directionStep] : undefined;
  steps.push(stepFromBrain("step_entry", "Entry", "entry", config.execution, executionDeps));

  return {
    version: 1,
    mode: "simple_4brain",
    source: "fourbrain_adapter",
    steps,
    management: config.management,
    notes: "Generated compatibility flow from the existing 4-Brain configuration.",
  };
}
