import type { StrategyStepRole } from "../types/blueprint";
import { getModuleContract } from "./module-contracts";
import type { BrainRole } from "./module-contracts";
import {
  MODULE_SEMANTIC_EVENT_TYPES,
  STRATEGY_EVENT_CONTRACTS,
  type StrategyEventCategory,
  type StrategyEventType,
} from "./strategy-events";

export type EventUiGroup = "retest" | "rejection" | "zone" | "bias" | "entry" | "other";

export interface StepEventOption {
  eventType: StrategyEventType;
  label: string;
  uiGroup: EventUiGroup;
  category: StrategyEventCategory;
}

function eventUiGroup(category: StrategyEventCategory, eventType: StrategyEventType): EventUiGroup {
  if (category === "zone_retest") return "retest";
  if (category === "entry" && /CONFIRMED|REJECTION|ENGULFING|PIN_BAR/i.test(eventType)) {
    return "rejection";
  }
  if (category === "zone") return "zone";
  if (category === "bias") return "bias";
  if (category === "entry" || category === "confirmation") return "entry";
  return "other";
}

const UI_GROUP_ORDER: EventUiGroup[] = ["retest", "zone", "rejection", "entry", "bias", "other"];

const UI_GROUP_LABEL: Record<EventUiGroup, string> = {
  retest: "Retest — price returned to zone/level",
  zone: "Zone / level formed",
  rejection: "Rejection / confirm — touch failed to break",
  entry: "Entry trigger",
  bias: "Bias / structure",
  other: "Other",
};

function sortEventOptions(options: StepEventOption[], role: StrategyStepRole): StepEventOption[] {
  const prioritizeRetest = role === "setup" || role === "confirmation";
  const prioritizeRejection = role === "confirmation" || role === "entry";
  return [...options].sort((a, b) => {
    const rank = (opt: StepEventOption) => {
      if (prioritizeRetest && opt.uiGroup === "retest") return 0;
      if (prioritizeRejection && opt.uiGroup === "rejection") return 1;
      if (opt.uiGroup === "zone") return 2;
      return 3 + UI_GROUP_ORDER.indexOf(opt.uiGroup);
    };
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return a.label.localeCompare(b.label);
  });
}

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

/** Contract-backed events a module exposes for a given step role (UI picker). */
export function eventsForStepRole(moduleId: string, role: StrategyStepRole): StepEventOption[] {
  const contract = getModuleContract(moduleId);
  if (!contract) return [];
  const roles = contractRolesForStepRole(role);
  const seen = new Set<StrategyEventType>();
  const options: StepEventOption[] = [];
  for (const semanticEvent of contract.semanticEvents) {
    if (!semanticEvent.roles.some((eventRole) => roles.includes(eventRole))) continue;
    const eventType = MODULE_SEMANTIC_EVENT_TYPES[moduleId]?.[semanticEvent.id];
    if (!eventType || seen.has(eventType)) continue;
    seen.add(eventType);
    const contractDef = STRATEGY_EVENT_CONTRACTS[eventType];
    options.push({
      eventType,
      label: contractDef?.label ?? eventType,
      uiGroup: eventUiGroup(contractDef?.category ?? "confirmation", eventType),
      category: contractDef?.category ?? "confirmation",
    });
  }
  return sortEventOptions(options, role);
}

/** Events grouped for labeled Select sections in the flow builder. */
export function eventsForStepRoleGrouped(
  moduleId: string,
  role: StrategyStepRole,
): Array<{ uiGroup: EventUiGroup; label: string; events: StepEventOption[] }> {
  const flat = eventsForStepRole(moduleId, role);
  const byGroup = new Map<EventUiGroup, StepEventOption[]>();
  for (const opt of flat) {
    const list = byGroup.get(opt.uiGroup) ?? [];
    list.push(opt);
    byGroup.set(opt.uiGroup, list);
  }
  return UI_GROUP_ORDER.filter((g) => byGroup.has(g)).map((uiGroup) => ({
    uiGroup,
    label: UI_GROUP_LABEL[uiGroup],
    events: byGroup.get(uiGroup)!,
  }));
}
