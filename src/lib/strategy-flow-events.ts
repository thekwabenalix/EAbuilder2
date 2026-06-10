import type { StrategyStepRole } from "../types/blueprint";
import { getModuleContract } from "./module-contracts";
import type { BrainRole } from "./module-contracts";
import { MODULE_SEMANTIC_EVENT_TYPES, type StrategyEventType } from "./strategy-events";

function contractRolesForStepRole(role: StrategyStepRole): BrainRole[] {
  if (role === "entry" || role === "confirmation") return ["execution"];
  if (role === "filter") return ["setup", "execution"];
  if (role === "context" || role === "risk") return ["direction", "setup", "execution"];
  return [role];
}

/** Pick the best contract-backed event for a module in a given step role. */
export function firstEventForRole(
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

export function moduleSupportsStrategyEvent(
  moduleId: string,
  eventType: StrategyEventType,
): boolean {
  return Object.values(MODULE_SEMANTIC_EVENT_TYPES[moduleId] ?? {}).includes(eventType);
}
