/**
 * Human-readable Strategy Flow step titles from role + module + timeframe.
 */

import type { StrategyStepConfig, StrategyStepRole } from "@/types/blueprint";
import { ALL_BRAIN_MODULES } from "@/lib/brain-modules";

function roleLabel(role: StrategyStepRole): string {
  switch (role) {
    case "context":
      return "Context";
    case "direction":
      return "Direction";
    case "setup":
      return "Setup";
    case "confirmation":
      return "Confirmation";
    case "entry":
      return "Entry";
    case "filter":
      return "Filter";
    case "risk":
      return "Risk";
    default:
      return role;
  }
}

/** Auto-generated names start with a role label — used to resync stale titles on edit. */
export const AUTO_STEP_NAME_PREFIX =
  /^(Context|Direction|Setup|Entry|Confirmation|Filter|Risk)\s/;

export function formatStepDisplayName(
  moduleId: string,
  timeframe: string,
  role: StrategyStepRole,
  options?: { index?: number; total?: number },
): string {
  const roleLabelText = roleLabel(role);
  const mod = ALL_BRAIN_MODULES.find((m) => m.id === moduleId);
  const moduleLabel = mod?.label ?? moduleId.replace(/_/g, " ");
  const base = `${roleLabelText} ${moduleLabel} ${timeframe}`;
  if (options?.total && options.total > 1 && options.index !== undefined) {
    return `${base} (${options.index + 1}/${options.total})`;
  }
  return base;
}

/** Keep custom names; refresh titles that still look auto-generated. */
export function syncStepNameIfAuto(step: StrategyStepConfig): StrategyStepConfig {
  const expected = formatStepDisplayName(step.module, step.timeframe, step.role);
  if (!step.name.trim() || AUTO_STEP_NAME_PREFIX.test(step.name.trim())) {
    return { ...step, name: expected };
  }
  return step;
}

export function normalizeFlowStepNames(steps: StrategyStepConfig[]): StrategyStepConfig[] {
  return steps.map(syncStepNameIfAuto);
}
