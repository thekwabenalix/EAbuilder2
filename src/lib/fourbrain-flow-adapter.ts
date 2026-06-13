/**
 * Phase 3 — faithful 4-Brain → StrategyFlow adapter.
 *
 * Expands every module in each brain to its own step (not just modules[0]).
 * Single-module brains keep stable step ids (step_direction / step_setup / step_entry).
 * Multi-module execution brains become parallel entry steps (OR semantics).
 *
 * Zone-scoped rejection: when execution is SNR `rejection` but setup (or misplaced
 * direction) is an SMC zone module, expand to setup → zone rejection → next-bar entry
 * instead of generic REJSM off unrelated levels.
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
import { MODULE_SEMANTIC_EVENT_TYPES } from "./strategy-events";
import { getModuleContract } from "./module-contracts";
import { firstEventForRole } from "./strategy-flow-events";
import { formatStepDisplayName } from "./strategy-step-label";

type BrainKind = "direction" | "setup" | "execution";

/** SMC zone modules whose rejection must scope to the zone — not SNR `rejection`. */
const ZONE_SCOPED_SETUP_MODULES = new Set<BrainModuleType>([
  "fvg",
  "fvg_inversion",
  "order_block",
  "ob_fvg",
  "unicorn",
  "breaker_block",
]);

function stepRoleForBrain(brain: BrainKind): StrategyStepRole {
  if (brain === "direction") return "direction";
  if (brain === "setup") return "setup";
  return "entry";
}

function contractSupportsBrain(moduleId: string, brain: BrainKind): boolean {
  const contract = getModuleContract(moduleId);
  if (!contract) return true;
  const role = brain === "execution" ? "execution" : brain;
  return contract.supportedRoles.includes(role);
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

function zoneActiveEvent(moduleId: string): StrategyEventType | undefined {
  return firstEventForRole(moduleId, "setup");
}

function zoneRejectionEvent(moduleId: string): StrategyEventType | undefined {
  const mapped = MODULE_SEMANTIC_EVENT_TYPES[moduleId];
  const fromSemantic =
    mapped?.zone_rejection ?? mapped?.overlap_entry ?? mapped?.confirmation;
  return fromSemantic ?? firstEventForRole(moduleId, "confirmation");
}

/**
 * Move zone-only modules out of Direction into Setup (e.g. Unicorn in direction slot).
 */
export function normalizeMisplacedModules(config: FourBrainConfig): FourBrainConfig {
  if (!config.direction?.modules?.length) return config;

  const dirOk = config.direction.modules.filter((m) => contractSupportsBrain(m, "direction"));
  const dirZone = config.direction.modules.filter(
    (m) => !contractSupportsBrain(m, "direction") && contractSupportsBrain(m, "setup"),
  );
  if (dirZone.length === 0) return config;

  const next: FourBrainConfig = { ...config };

  if (!next.setup) {
    next.setup = {
      modules: dirZone as BrainModuleType[],
      timeframe: config.direction!.timeframe,
      params: config.direction!.params,
      description: config.direction!.description,
    };
  }

  next.direction =
    dirOk.length > 0
      ? { ...config.direction!, modules: dirOk as BrainModuleType[] }
      : undefined;

  return next;
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
    ? config.modules.filter((m) => contractSupportsBrain(m, brain))
    : ["custom"];
  if (modules.length === 0) return [];

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
      slSource: { mode: "event_sl" as const, bufferPoints: 0 },
      notes: config.description,
    };
  });
}

/** Downstream brains depend on all parallel steps from the prior brain (OR group). */
export function downstreamAnchorSteps(steps: StrategyStepConfig[]): StrategyStepConfig[] {
  return steps.length > 0 ? [...steps] : [];
}

function resolveZoneModule(config: FourBrainConfig): BrainModuleType | null {
  const setupMod =
    config.setup?.modules?.length === 1 ? config.setup.modules[0] : undefined;
  if (setupMod && ZONE_SCOPED_SETUP_MODULES.has(setupMod)) return setupMod;

  const dirMod =
    config.direction?.modules?.length === 1 ? config.direction.modules[0] : undefined;
  if (dirMod && ZONE_SCOPED_SETUP_MODULES.has(dirMod) && !config.setup) return dirMod;

  return null;
}

/**
 * SNR `rejection` in execution + SMC zone in setup → zone-scoped 3-step chain.
 */
function tryBuildZoneScopedRejectionFlow(config: FourBrainConfig): StrategyFlowConfig | null {
  if (config.execution?.modules?.length !== 1) return null;
  if (config.execution.modules[0] !== "rejection") return null;

  const zoneMod = resolveZoneModule(config);
  if (!zoneMod) return null;

  const activeEv = zoneActiveEvent(zoneMod);
  const rejectEv = zoneRejectionEvent(zoneMod);
  if (!activeEv || !rejectEv) return null;

  const zoneTf = config.setup?.timeframe ?? config.direction?.timeframe ?? config.execution.timeframe;
  const entryTf = config.execution.timeframe;
  const params = config.setup?.params ?? config.direction?.params ?? config.execution.params;

  const steps: StrategyStepConfig[] = [];
  let priorAnchor: StrategyStepConfig[] = [];
  let directionAnchor: StrategyStepConfig | undefined;

  if (config.direction) {
    const dirSteps = expandBrainToSteps("direction", config.direction, [], undefined);
    if (dirSteps.length) {
      steps.push(...dirSteps);
      directionAnchor = dirSteps[0];
      priorAnchor = downstreamAnchorSteps(dirSteps);
    }
  }

  const setupStep: StrategyStepConfig = {
    id: "step_setup",
    name: formatStepDisplayName(zoneMod, zoneTf, "setup"),
    role: "setup",
    module: zoneMod,
    timeframe: zoneTf,
    event: activeEv,
    enabled: true,
    params,
    dependsOn: priorAnchor.length
      ? priorAnchor.map((s) => ({
          stepId: s.id,
          relation: "after" as const,
          required: true,
          ...(priorAnchor.length > 1 ? { orGroup: "direction_or" as const } : {}),
        }))
      : undefined,
    directionSource: directionAnchor
      ? { mode: "from_step" as const, stepId: directionAnchor.id }
      : { mode: "own_event" as const },
    slSource: { mode: "event_sl" as const, bufferPoints: 0 },
    notes: "Zone pocket armed — SNR rejection remapped to zone-scoped SMC confirm.",
  };
  steps.push(setupStep);

  const confirmStep: StrategyStepConfig = {
    id: "step_confirm",
    name: formatStepDisplayName(zoneMod, zoneTf, "confirmation"),
    role: "confirmation",
    module: zoneMod,
    timeframe: zoneTf,
    event: rejectEv,
    enabled: true,
    params,
    dependsOn: [{ stepId: setupStep.id, relation: "after", required: true }],
    directionSource: directionAnchor
      ? { mode: "from_step" as const, stepId: directionAnchor.id }
      : { mode: "own_event" as const },
    slSource: { mode: "event_sl" as const, bufferPoints: 0 },
  };
  steps.push(confirmStep);

  const entryStep: StrategyStepConfig = {
    id: "step_entry",
    name: formatStepDisplayName(zoneMod, entryTf, "entry"),
    role: "entry",
    module: zoneMod,
    timeframe: entryTf,
    event: "BAR_AFTER_CONFIRM",
    enabled: true,
    params,
    dependsOn: [{ stepId: confirmStep.id, relation: "after", required: true }],
    directionSource: { mode: "from_step" as const, stepId: confirmStep.id },
    slSource: { mode: "event_sl" as const, bufferPoints: 0 },
    notes: "Enter next bar after zone rejection (was SNR rejection in 4-Brain UI).",
  };
  steps.push(entryStep);

  return {
    version: 1,
    mode: "simple_4brain",
    source: "fourbrain_adapter",
    steps,
    management: config.management,
    notes:
      "Remapped execution SNR Rejection to zone-scoped SMC confirm + next-bar entry on the setup zone module.",
  };
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

/** True when execution is SNR rejection and setup/direction is an SMC zone module. */
export function fourBrainUsesZoneScopedRejection(config: FourBrainConfig): boolean {
  const normalized = normalizeMisplacedModules(config);
  return tryBuildZoneScopedRejectionFlow(normalized) !== null;
}

export function fourBrainToStrategyFlow(config: FourBrainConfig): StrategyFlowConfig {
  const normalized = normalizeMisplacedModules(config);
  const zoneFlow = tryBuildZoneScopedRejectionFlow(normalized);
  if (zoneFlow) return zoneFlow;

  const steps: StrategyStepConfig[] = [];
  let priorAnchor: StrategyStepConfig[] = [];
  let directionAnchor: StrategyStepConfig | undefined;

  if (normalized.direction) {
    const dirSteps = expandBrainToSteps("direction", normalized.direction, [], undefined);
    steps.push(...dirSteps);
    directionAnchor = dirSteps[0];
    priorAnchor = downstreamAnchorSteps(dirSteps);
  }

  if (normalized.setup) {
    const setupSteps = expandBrainToSteps("setup", normalized.setup, priorAnchor, directionAnchor);
    steps.push(...setupSteps);
    priorAnchor = downstreamAnchorSteps(setupSteps);
  }

  const entrySteps = expandBrainToSteps(
    "execution",
    normalized.execution,
    priorAnchor,
    directionAnchor,
  );
  steps.push(...entrySteps);

  return {
    version: 1,
    mode: "simple_4brain",
    source: "fourbrain_adapter",
    steps,
    management: normalized.management,
    notes: adapterNotes(normalized),
  };
}
