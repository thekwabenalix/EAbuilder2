import type { BrainConfig, FourBrainConfig, StrategyBlueprint } from "@/types/blueprint";
import { getModuleAdmission } from "@/lib/module-admission";

export interface BlueprintExplanationItem {
  label: string;
  value: string;
  status: "ok" | "warn" | "blocked";
  source: "prompt" | "ai" | "default" | "system";
}

export interface BrainExplanation {
  role: "Direction" | "Setup" | "Execution";
  timeframe: string;
  modules: string;
  params: BlueprintExplanationItem[];
  description: string;
  admission: BlueprintExplanationItem[];
}

export interface BlueprintExplanation {
  brains: BrainExplanation[];
  management: BlueprintExplanationItem[];
  indicators: BlueprintExplanationItem[];
  filters: BlueprintExplanationItem[];
  contract: BlueprintExplanationItem[];
  audit: BlueprintExplanationItem[];
  blockedModules: BlueprintExplanationItem[];
  summary: string;
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Not specified";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function sourceForValue(value: unknown): BlueprintExplanationItem["source"] {
  return value === undefined || value === null || value === "" ? "default" : "prompt";
}

function moduleLabel(moduleId: string): string {
  return getModuleAdmission(moduleId)?.label ?? moduleId.replace(/_/g, " ").toUpperCase();
}

function paramItems(brain: BrainConfig): BlueprintExplanationItem[] {
  const params = brain.params ?? {};
  return Object.entries(params).map(([key, value]) => ({
    label: key,
    value: displayValue(value),
    status: "ok" as const,
    source: sourceForValue(value),
  }));
}

function admissionItems(brain: BrainConfig): BlueprintExplanationItem[] {
  return brain.modules.map((moduleId) => {
    const admission = getModuleAdmission(moduleId);
    if (!admission) {
      return {
        label: moduleId,
        value: "Not admitted",
        status: "blocked" as const,
        source: "system" as const,
      };
    }
    return {
      label: admission.label,
      value: admission.status.replace(/_/g, " "),
      status: admission.status === "verified_state_machine" ? ("ok" as const) : ("warn" as const),
      source: "system" as const,
    };
  });
}

function explainBrain(
  role: BrainExplanation["role"],
  brain: BrainConfig | undefined,
): BrainExplanation | undefined {
  if (!brain) return undefined;
  return {
    role,
    timeframe: brain.timeframe,
    modules: brain.modules.map(moduleLabel).join(" + "),
    params: paramItems(brain),
    description: brain.description ?? "",
    admission: admissionItems(brain),
  };
}

function managementItems(config?: FourBrainConfig): BlueprintExplanationItem[] {
  const management = config?.management ?? {};
  return [
    ["Risk", management.riskPercent ?? 1, "%"],
    ["Reward : Risk", management.rewardRisk ?? 2, "R"],
    ["Stop buffer", management.stopBuffer ?? 20, "points"],
    ["Max stop", management.maxStopPoints ?? 0, "points"],
    ["Break-even", management.breakEvenEnabled ?? false, ""],
    ["Break-even at", management.breakEvenAtR ?? 1, "R"],
    ["Max open trades", management.maxOpenTrades ?? 1, ""],
  ].map(([label, value, suffix]) => ({
    label: String(label),
    value: `${displayValue(value)}${suffix ? ` ${suffix}` : ""}`,
    status: "ok" as const,
    source: sourceForValue(value),
  }));
}

function indicatorItems(blueprint: StrategyBlueprint): BlueprintExplanationItem[] {
  return (blueprint.indicatorRefs ?? []).map((indicator) => ({
    label: indicator.name,
    value: `${indicator.via === "icustom" ? "iCustom" : indicator.mql5} / ${indicator.category}`,
    status: "warn" as const,
    source: "system" as const,
  }));
}

function filterItems(blueprint: StrategyBlueprint): BlueprintExplanationItem[] {
  return (blueprint.filterRefs ?? []).map((filter) => ({
    label: filter.label,
    value: `${filter.appliesTo ?? "execution"} / ${filter.timeframe} / ${Object.entries(
      filter.params,
    )
      .map(([key, value]) => `${key}=${displayValue(value)}`)
      .join(", ")}`,
    status: "ok" as const,
    source: "system" as const,
  }));
}

function contractItems(blueprint: StrategyBlueprint): BlueprintExplanationItem[] {
  const contract = blueprint.intentContract;
  if (!contract) return [];
  const items: BlueprintExplanationItem[] = [];
  if (contract.sequence.length > 0) {
    items.push({
      label: "Sequence",
      value: contract.sequence.join(" -> "),
      status: "ok",
      source: "system",
    });
  }
  if (contract.setup?.targetLabel) {
    items.push({
      label: "Setup target",
      value: contract.setup.targetLabel,
      status: "ok",
      source: "system",
    });
  }
  if (contract.execution) {
    items.push({
      label: "Execution",
      value: `${contract.execution.module} / ${contract.execution.entryEvent}`,
      status: "ok",
      source: "system",
    });
  }
  for (const constraint of contract.constraints) {
    items.push({
      label: constraint.label,
      value: constraint.value,
      status: "ok",
      source: "system",
    });
  }
  return items;
}

function auditItems(blueprint: StrategyBlueprint): BlueprintExplanationItem[] {
  return (blueprint.blueprintAudit ?? []).map((item) => ({
    label: item.code,
    value: item.message,
    status:
      item.severity === "error"
        ? ("blocked" as const)
        : item.severity === "warn"
          ? ("warn" as const)
          : ("ok" as const),
    source: "system" as const,
  }));
}

export function explainBlueprintExtraction(blueprint: StrategyBlueprint): BlueprintExplanation {
  const config = blueprint.fourBrain;
  const brains = [
    explainBrain("Direction", config?.direction),
    explainBrain("Setup", config?.setup),
    explainBrain("Execution", config?.execution),
  ].filter((brain): brain is BrainExplanation => Boolean(brain));

  const blockedModules = brains.flatMap((brain) =>
    brain.admission.filter((item) => item.status !== "ok"),
  );
  const summary =
    config && brains.length > 0
      ? `Extracted ${brains.length} active brain${brains.length === 1 ? "" : "s"} from the strategy.`
      : "No 4-Brain mapping was extracted yet.";

  return {
    brains,
    management: managementItems(config),
    indicators: indicatorItems(blueprint),
    filters: filterItems(blueprint),
    contract: contractItems(blueprint),
    audit: auditItems(blueprint),
    blockedModules,
    summary,
  };
}

export function blueprintContractErrors(blueprint: StrategyBlueprint): string[] {
  return (blueprint.blueprintAudit ?? [])
    .filter((item) => item.severity === "error")
    .map((item) => item.message);
}

export function firstBlueprintContractError(blueprint: StrategyBlueprint): string | undefined {
  return blueprintContractErrors(blueprint)[0];
}
