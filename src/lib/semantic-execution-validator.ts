/**
 * Post-generation semantic parity checks.
 *
 * The blueprint gate proves that the requested strategy is structurally valid.
 * This validator proves that emitted MQL5 contains every configured runtime step.
 */

import type {
  FourBrainConfig,
  StrategyBlueprint,
  StrategyFlowConfig,
  StrategyStepConfig,
} from "@/types/blueprint";
import { getSmFlowProfile } from "@/generators/sm-embed-registry";

export interface SemanticExecutionValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

function enabledSteps(flow: StrategyFlowConfig): StrategyStepConfig[] {
  return (flow.steps ?? []).filter((step) => step.enabled !== false);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function functionBody(code: string, name: string): string | null {
  const pattern = new RegExp(`\\bvoid\\s+${escapeRegex(name)}\\s*\\(\\s*\\)\\s*\\{`);
  const start = code.search(pattern);
  if (start < 0) return null;
  const open = code.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return null;
}

function moduleRuntimeToken(moduleId: string, timeframe: string): string | null {
  const profile = getSmFlowProfile(moduleId);
  return profile ? `${profile.prefix}_${timeframe.toUpperCase()}_` : null;
}

function pushUnique(target: string[], message: string): void {
  if (!target.includes(message)) target.push(message);
}

function validateConfiguredModuleTokens(
  code: string,
  modules: string[],
  timeframe: string,
  owner: string,
  errors: string[],
  warnings: string[],
): void {
  for (const moduleId of modules) {
    const token = moduleRuntimeToken(moduleId, timeframe);
    if (!token) {
      pushUnique(warnings, `${owner}: ${moduleId} has no registered state-machine token.`);
    } else if (!code.includes(token)) {
      pushUnique(
        errors,
        `${owner}: configured module ${moduleId} @ ${timeframe} is missing from generated runtime code.`,
      );
    }
  }
}

function validateFlowCode(
  code: string,
  flow: StrategyFlowConfig,
  errors: string[],
  warnings: string[],
): void {
  const steps = enabledSteps(flow);
  const stepCount = code.match(/#define\s+STEP_COUNT\s+(\d+)/)?.[1];
  if (Number(stepCount) !== steps.length) {
    pushUnique(
      errors,
      `Strategy Flow expected ${steps.length} enabled steps, but generated runtime declares ${stepCount ?? "none"}.`,
    );
  }

  steps.forEach((step, index) => {
    const escapedName = (step.name || step.role).replace(/"/g, "");
    if (!code.includes(`gStepName[${index}] = "${escapedName}"`)) {
      pushUnique(errors, `Step ${index + 1} (${step.name}) is missing from runtime initialization.`);
    }
    validateConfiguredModuleTokens(
      code,
      [String(step.module)],
      String(step.timeframe),
      `Step ${index + 1} (${step.role})`,
      errors,
      warnings,
    );
  });

  const entryIndexes = steps
    .map((step, index) => (step.role === "entry" ? index : -1))
    .filter((index) => index >= 0);
  if (entryIndexes.length === 0) {
    pushUnique(errors, "Strategy Flow has no enabled entry step in generated runtime.");
  }
  for (const index of entryIndexes) {
    if (!code.includes(`OpenTrade(${index}, dir)`)) {
      pushUnique(errors, `Entry step ${index + 1} is not connected to the trade execution gate.`);
    }
  }
}

type BrainKey = "direction" | "setup" | "execution";

const BRAIN_RUNTIME: Record<
  BrainKey,
  { functionName: string; activation: RegExp; label: string }
> = {
  direction: {
    functionName: "Direction_Brain_Execute",
    activation: /\bgBias\s*=/,
    label: "Direction Brain",
  },
  setup: {
    functionName: "Setup_Brain_Execute",
    activation: /\bgSetupActive\s*=\s*(?:true|\(gBias\s*!=\s*0\))/,
    label: "Setup Brain",
  },
  execution: {
    functionName: "Execution_Brain_Execute",
    activation: /\bgExecSignal\s*=\s*true/,
    label: "Execution Brain",
  },
};

function validateAssemblerBrain(
  code: string,
  config: FourBrainConfig,
  key: BrainKey,
  errors: string[],
  warnings: string[],
): void {
  const brain = config[key];
  const modules = brain?.modules ?? [];
  if (!modules.length) return;

  const runtime = BRAIN_RUNTIME[key];
  const body = functionBody(code, runtime.functionName);
  if (body == null) {
    pushUnique(errors, `${runtime.label} is configured but its runtime function is missing.`);
    return;
  }
  if (/not yet implemented|signal detection not yet implemented/i.test(body)) {
    pushUnique(errors, `${runtime.label} contains an unimplemented module placeholder.`);
  }
  if (!runtime.activation.test(body)) {
    pushUnique(errors, `${runtime.label} is configured but cannot activate its runtime state.`);
  }
  validateConfiguredModuleTokens(
    code,
    modules.map(String),
    String(brain?.timeframe ?? ""),
    runtime.label,
    errors,
    warnings,
  );
}

export function validateGeneratedExecutionParity(input: {
  blueprint: StrategyBlueprint;
  flow: StrategyFlowConfig;
  code: string;
  path: "flow_engine" | "blueprint_assembler" | "legacy_heuristic";
}): SemanticExecutionValidation {
  const { blueprint, flow, code, path } = input;
  const errors: string[] = [];
  const warnings: string[] = [];

  if (/not yet implemented|signal detection not yet implemented/i.test(code)) {
    pushUnique(errors, "Generated EA contains an unimplemented module placeholder.");
  }

  if (path === "flow_engine") {
    validateFlowCode(code, flow, errors, warnings);
  } else if (blueprint.fourBrain) {
    validateAssemblerBrain(code, blueprint.fourBrain, "direction", errors, warnings);
    validateAssemblerBrain(code, blueprint.fourBrain, "setup", errors, warnings);
    validateAssemblerBrain(code, blueprint.fourBrain, "execution", errors, warnings);
  }

  if (!/\b(?:trade\.Buy|trade\.Sell|OpenTrade)\s*\(/.test(code)) {
    pushUnique(errors, "Generated EA has no reachable trade-order function.");
  }

  return { ok: errors.length === 0, errors, warnings };
}

