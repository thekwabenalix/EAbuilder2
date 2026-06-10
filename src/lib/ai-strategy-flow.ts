/**
 * Phase 6 — normalize AI strategy_flow steps into StrategyFlowConfig.
 *
 * AI returns structured steps (not MQL5 brain bodies) when output_mode is
 * "strategy_flow". The flow engine compiles those steps via generateEaFromBlueprint.
 */

import type { AiBrainWiring } from "@/lib/api-client";
import type {
  FourBrainConfig,
  StrategyBlueprint,
  StrategyFlowConfig,
  StrategyStepConfig,
  StrategyStepDependency,
  StrategyStepDependencyRelation,
  StrategyStepRole,
} from "@/types/blueprint";
import { getModuleAdmission } from "@/lib/module-admission";
import { firstEventForRole, validateStrategyFlowSchema } from "@/lib/strategy-flow";
import type { StrategyEventType } from "@/lib/strategy-events";

export type AiOutputMode = "strategy_flow" | "brain_bodies";

/** Partial step shape the AI may return before normalization. */
export type AiStrategyFlowStepInput = {
  id?: string;
  name?: string;
  role?: string;
  module?: string;
  timeframe?: string;
  event?: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
  dependsOn?: Array<{
    stepId: string;
    relation?: string;
    required?: boolean;
    withinBars?: number;
  }>;
  directionSource?: StrategyStepConfig["directionSource"];
  reset?: StrategyStepConfig["reset"];
  slSource?: StrategyStepConfig["slSource"];
  notes?: string;
};

export interface AiStrategyFlowPayload {
  version?: number;
  steps?: AiStrategyFlowStepInput[];
  notes?: string;
}

type StrategyFlowCarrier = {
  output_mode?: AiOutputMode | string;
  strategy_flow?: AiStrategyFlowPayload;
};

function normalizeRole(raw: string | undefined, index: number): StrategyStepRole {
  const role = (raw ?? "").trim().toLowerCase();
  if (role === "direction") return "direction";
  if (role === "setup") return "setup";
  if (role === "entry" || role === "execution") return "entry";
  if (role === "confirmation") return "confirmation";
  if (role === "filter") return "filter";
  if (role === "context") return "context";
  if (role === "risk") return "risk";
  if (index === 0) return "direction";
  if (index === 1) return "setup";
  return "entry";
}

function defaultStepId(role: StrategyStepRole, roleIndex: number): string {
  if (roleIndex === 0) {
    if (role === "direction") return "step_direction";
    if (role === "setup") return "step_setup";
    if (role === "entry" || role === "confirmation") return "step_entry";
  }
  const slug =
    role === "entry" || role === "confirmation"
      ? "entry"
      : role === "setup"
        ? "setup"
        : role === "direction"
          ? "direction"
          : role;
  return `step_${slug}_${roleIndex}`;
}

function normalizeTimeframe(raw: string | undefined): string {
  const tf = (raw ?? "M5").trim().toUpperCase();
  return tf === "MN" ? "MN1" : tf;
}

function resolveEvent(moduleId: string, role: StrategyStepRole, raw?: string): StrategyEventType {
  const event = (raw ?? "").trim();
  if (event) return event as StrategyEventType;
  return (
    firstEventForRole(moduleId, role) ??
    firstEventForRole(moduleId, "entry") ??
    "BOS_CONFIRMED"
  );
}

function normalizeRelation(raw?: string): StrategyStepDependencyRelation {
  const relation = (raw ?? "after").trim().toLowerCase();
  if (relation === "same_bar" || relation === "same_or_after") return "same_or_after";
  if (relation === "before") return "before";
  return "after";
}

function normalizeDependsOn(
  raw?: AiStrategyFlowStepInput["dependsOn"],
): StrategyStepDependency[] | undefined {
  if (!raw?.length) return undefined;
  return raw.map((dep) => ({
    stepId: dep.stepId,
    relation: normalizeRelation(dep.relation),
    required: dep.required ?? true,
    withinBars: dep.withinBars,
  }));
}

function normalizeAiStep(
  raw: AiStrategyFlowStepInput,
  index: number,
  roleCounts: Map<StrategyStepRole, number>,
): StrategyStepConfig {
  const role = normalizeRole(raw.role, index);
  const roleIndex = roleCounts.get(role) ?? 0;
  roleCounts.set(role, roleIndex + 1);

  const moduleId = (raw.module ?? "custom").trim().toLowerCase();
  const timeframe = normalizeTimeframe(raw.timeframe);
  const id = (raw.id ?? "").trim() || defaultStepId(role, roleIndex);
  const name =
    (raw.name ?? "").trim() ||
    `${role.charAt(0).toUpperCase()}${role.slice(1)} ${moduleId.toUpperCase()} ${timeframe}`;

  return {
    id,
    name,
    role,
    module: moduleId,
    timeframe,
    event: resolveEvent(moduleId, role, raw.event),
    enabled: raw.enabled !== false,
    params: raw.params ?? {},
    dependsOn: normalizeDependsOn(raw.dependsOn),
    directionSource: raw.directionSource,
    reset: raw.reset,
    slSource: raw.slSource,
    notes: raw.notes,
  };
}

function inferMissingDependencies(steps: StrategyStepConfig[]): void {
  const directionSteps = steps.filter((s) => s.role === "direction");
  const setupSteps = steps.filter((s) => s.role === "setup");
  const entrySteps = steps.filter(
    (s) => s.role === "entry" || s.role === "confirmation",
  );

  const dep = (stepId: string): StrategyStepDependency => ({
    stepId,
    relation: "after",
    required: true,
  });

  for (const step of setupSteps) {
    if (step.dependsOn?.length || directionSteps.length === 0) continue;
    step.dependsOn =
      directionSteps.length > 1
        ? directionSteps.map((d) => dep(d.id))
        : [dep(directionSteps[directionSteps.length - 1]!.id)];
  }

  for (const step of entrySteps) {
    if (step.dependsOn?.length) continue;
    if (setupSteps.length > 0) {
      step.dependsOn = [dep(setupSteps[0]!.id)];
    } else if (directionSteps.length > 0) {
      step.dependsOn = [dep(directionSteps[directionSteps.length - 1]!.id)];
    }
  }

  const primaryDirection = directionSteps[0];
  for (const step of steps) {
    if (step.role === "direction") {
      if (!step.directionSource) step.directionSource = { mode: "own_event" };
      continue;
    }
    if (!step.directionSource && primaryDirection) {
      step.directionSource = { mode: "from_step", stepId: primaryDirection.id };
    }
  }
}

/** True when AI returned at least one strategy flow step to compile. */
export function aiWiringHasStrategyFlow(wiring: StrategyFlowCarrier): boolean {
  if (wiring.output_mode === "brain_bodies") return false;
  return (wiring.strategy_flow?.steps?.length ?? 0) > 0;
}

export function usesStrategyFlowOutput(response: StrategyFlowCarrier): boolean {
  return aiWiringHasStrategyFlow(response);
}

function findUnsafeAiModules(modules: string[]): string[] {
  const unique = [...new Set(modules.filter(Boolean).map((m) => m.toLowerCase()))];
  return unique
    .map((moduleId) => {
      const admission = getModuleAdmission(moduleId);
      if (!admission) return `${moduleId}: module has no admission record`;
      if (admission.status !== "verified_state_machine") {
        return `${moduleId}: ${admission.label} is ${admission.status.replace(/_/g, " ")}; ${admission.notes}`;
      }
      return null;
    })
    .filter((reason): reason is string => Boolean(reason));
}

/** Normalize raw AI steps into a validated StrategyFlowConfig. */
export function strategyFlowFromAiWiring(
  wiring: StrategyFlowCarrier & Pick<AiBrainWiring, "notes">,
  fourBrain?: FourBrainConfig,
): StrategyFlowConfig {
  const roleCounts = new Map<StrategyStepRole, number>();
  const steps = (wiring.strategy_flow?.steps ?? []).map((raw, index) =>
    normalizeAiStep(raw, index, roleCounts),
  );
  inferMissingDependencies(steps);

  return {
    version: 1,
    mode: "ai_extracted",
    source: "ai",
    steps,
    management: fourBrain?.management,
    notes: wiring.strategy_flow?.notes ?? wiring.notes,
  };
}

export function mergeAiFlowIntoBlueprint(
  blueprint: StrategyBlueprint,
  wiring: AiBrainWiring,
): StrategyBlueprint {
  if (!aiWiringHasStrategyFlow(wiring)) return blueprint;
  return {
    ...blueprint,
    strategyFlow: strategyFlowFromAiWiring(wiring, blueprint.fourBrain),
  };
}

export interface AiStrategyFlowValidation {
  status: "pass" | "warn" | "fail";
  errors: string[];
  warnings: string[];
}

/** Validate AI strategy_flow steps (schema + module admission). */
export function validateAiStrategyFlowWiring(
  wiring: StrategyFlowCarrier & { semantics?: { modules?: string[] } },
): AiStrategyFlowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!aiWiringHasStrategyFlow(wiring)) {
    return { status: "pass", errors, warnings };
  }

  const flow = strategyFlowFromAiWiring(wiring as AiBrainWiring);
  const schema = validateStrategyFlowSchema(flow);
  errors.push(...schema.errors);
  warnings.push(...schema.warnings);

  const modules = [
    ...new Set([
      ...(wiring.semantics?.modules ?? []),
      ...flow.steps.map((s) => s.module),
    ]),
  ];
  const unsafe = findUnsafeAiModules(modules);
  if (unsafe.length) {
    errors.push(
      `AI strategy flow uses module(s) not admitted for AI generation: ${unsafe.join(" | ")}`,
    );
  }

  for (const step of flow.steps) {
    const admission = getModuleAdmission(step.module);
    if (!admission) {
      warnings.push(`Step ${step.id} module "${step.module}" has no admission record.`);
    }
  }

  const status = errors.length ? "fail" : warnings.length ? "warn" : "pass";
  return { status, errors, warnings };
}

/** Coerce parsed AI JSON: set output_mode and ensure strategy_flow shape. */
export function normalizeAiStrategyFlowInResponse(
  response: StrategyFlowCarrier & { strategy_flow?: AiStrategyFlowPayload },
): void {
  const steps = response.strategy_flow?.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    if (response.output_mode !== "strategy_flow") {
      response.output_mode = "brain_bodies";
    }
    return;
  }

  response.output_mode = "strategy_flow";
  response.strategy_flow = {
    version: 1,
    steps,
    notes: response.strategy_flow?.notes,
  };
}
