/**
 * Phase 3 — faithful 4-Brain → StrategyFlow adapter.
 *
 * Expands every module in each brain to its own step (not just modules[0]).
 * Single-module brains keep stable step ids (step_direction / step_setup / step_entry).
 * Multi-module execution brains become parallel entry steps (OR semantics).
 * Multi-module direction/setup brains expand in parallel; downstream steps use
 * orGroup dependencies so any parallel upstream step can satisfy the gate.
 */

import type {
  BrainConfig,
  BrainModuleType,
  FourBrainConfig,
  StrategyFlowConfig,
  StrategyStepConfig,
  StrategyStepDependency,
  StrategyStepRole,
} from "../types/blueprint";
import type { StrategyEventType } from "./strategy-events";
import { firstEventForRole } from "./strategy-flow-events";
import { formatStepDisplayName } from "./strategy-step-label";

type BrainKind = "direction" | "setup" | "execution";

function stepRoleForBrain(brain: BrainKind): StrategyStepRole {
  if (brain === "direction") return "direction";
  if (brain === "setup") return "setup";
  return "entry";
}

/** Stable ids for the common single-module 4-Brain shape (verify + saved strategies). */
export function moduleStepId(brain: BrainKind, index: number, total: number): string {
  if (total === 1) {
    if (brain === "direction") return "step_direction";
    if (brain === "setup") return "step_setup";
    return "step_entry";
  }
  const slug = brain === "execution" ? "entry" : brain;
  return `step_${slug}_${index}`;
}

function stepLabel(
  brain: BrainKind,
  moduleId: string,
  timeframe: string,
  index: number,
  total: number,
): string {
  const role = stepRoleForBrain(brain);
  return formatStepDisplayName(moduleId, timeframe, role, { index, total });
}

function resolveEvent(moduleId: string, role: StrategyStepRole): StrategyEventType {
  return (
    firstEventForRole(moduleId, role) ?? firstEventForRole(moduleId, "entry") ?? "BOS_CONFIRMED"
  );
}

function buildDependsOn(
  brain: BrainKind,
  moduleIndex: number,
  moduleCount: number,
  priorBrainAnchor: StrategyStepConfig[],
): StrategyStepDependency[] | undefined {
  if (priorBrainAnchor.length === 0) return undefined;

  if (priorBrainAnchor.length === 1) {
    return [{ stepId: priorBrainAnchor[0].id, relation: "after", required: true }];
  }

  const orGroup =
    brain === "execution" ? "setup_or" : brain === "setup" ? "direction_or" : "prior_or";

  return priorBrainAnchor.map((step) => ({
    stepId: step.id,
    relation: "after" as const,
    required: true,
    orGroup,
  }));
}

function expandBrainToSteps(
  brain: BrainKind,
  config: BrainConfig,
  priorBrainAnchor: StrategyStepConfig[],
  directionAnchor: StrategyStepConfig | undefined,
): StrategyStepConfig[] {
  const modules: Array<BrainModuleType | string> = config.modules?.length
    ? [...config.modules]
    : ["custom"];
  const role = stepRoleForBrain(brain);
  const total = modules.length;

  return modules.map((moduleId, index) => {
    const dependsOn = buildDependsOn(brain, index, total, priorBrainAnchor);
    const dirSource =
      role === "direction"
        ? { mode: "own_event" as const }
        : directionAnchor
          ? { mode: "from_step" as const, stepId: directionAnchor.id }
          : { mode: "own_event" as const };

    return {
      id: moduleStepId(brain, index, total),
      name: stepLabel(brain, moduleId, config.timeframe, index, total),
      role,
      module: moduleId,
      timeframe: config.timeframe,
      event: resolveEvent(moduleId, role),
      enabled: true,
      params: config.params,
      dependsOn,
      directionSource: dirSource,
      slSource:
        role === "entry"
          ? { mode: "event_sl" as const, bufferPoints: 0 }
          : { mode: "event_sl" as const, bufferPoints: 0 },
      notes: config.description,
    };
  });
}

/** Downstream brains depend on all parallel steps from the prior brain (OR group). */
export function downstreamAnchorSteps(steps: StrategyStepConfig[]): StrategyStepConfig[] {
  return steps.length > 0 ? [...steps] : [];
}

function adapterNotes(config: FourBrainConfig): string {
  const multi: string[] = [];
  if ((config.direction?.modules?.length ?? 0) > 1) multi.push("direction");
  if ((config.setup?.modules?.length ?? 0) > 1) multi.push("setup");
  if ((config.execution?.modules?.length ?? 0) > 1) multi.push("execution");

  if (multi.length === 0) {
    return "Generated compatibility flow from the existing 4-Brain configuration.";
  }

  const parts = multi.map((brain) => {
    if (brain === "execution") {
      return "execution modules become parallel entry steps (any may fire)";
    }
    return `${brain} modules expand in parallel; downstream steps accept any via orGroup`;
  });
  return `Generated from 4-Brain config. ${parts.join("; ")}.`;
}

export function fourBrainToStrategyFlow(config: FourBrainConfig): StrategyFlowConfig {
  const steps: StrategyStepConfig[] = [];
  let priorAnchor: StrategyStepConfig[] = [];
  let directionAnchor: StrategyStepConfig | undefined;

  if (config.direction) {
    const dirSteps = expandBrainToSteps("direction", config.direction, [], undefined);
    steps.push(...dirSteps);
    directionAnchor = dirSteps[0];
    priorAnchor = downstreamAnchorSteps(dirSteps);
  }

  if (config.setup) {
    const setupSteps = expandBrainToSteps("setup", config.setup, priorAnchor, directionAnchor);
    steps.push(...setupSteps);
    priorAnchor = downstreamAnchorSteps(setupSteps);
  }

  const entrySteps = expandBrainToSteps(
    "execution",
    config.execution,
    priorAnchor,
    directionAnchor,
  );
  steps.push(...entrySteps);

  return {
    version: 1,
    mode: "simple_4brain",
    source: "fourbrain_adapter",
    steps,
    management: config.management,
    notes: adapterNotes(config),
  };
}
