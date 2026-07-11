/**
 * Rich platform context for the in-app EA assistant (ea-chat).
 * Keeps generation architecture + strategy flow visible to the copilot.
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import { buildModuleRepairPlan, MODULE_ADMISSION } from "@/lib/module-admission";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import { buildExpectedTradePath } from "@/lib/trade-audit";
import { generationPathLabel, previewEaGeneration } from "@/lib/generate-ea-router";
import { ALL_BRAIN_MODULES, MODULE_BY_ID } from "@/lib/brain-modules";
import { MODULE_CONTRACTS } from "@/lib/module-contracts";
import { INDICATOR_CATEGORY_LABEL, INDICATOR_REGISTRY } from "@/lib/indicator-registry";
import { STRATEGY_FAMILIES, familyLabel, moduleAllowedInFamily } from "@/lib/strategy-family";

function brainModules(blueprint: StrategyBlueprint): string[] {
  const fb = blueprint.fourBrain;
  if (!fb) return [];
  return [
    ...(fb.direction?.modules ?? []),
    ...(fb.setup?.modules ?? []),
    ...(fb.execution?.modules ?? []),
  ];
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function selectedModuleIds(blueprint: StrategyBlueprint): string[] {
  const flowModules = blueprint.strategyFlow?.steps?.map((s) => s.module) ?? [];
  return uniqueStrings([...brainModules(blueprint), ...flowModules]);
}

function shortParams(params: object | undefined): string {
  if (!params || Object.keys(params).length === 0) return "{}";
  const entries = Object.entries(params).slice(0, 8);
  const body = Object.fromEntries(entries);
  const suffix = Object.keys(params).length > entries.length ? " ..." : "";
  return `${JSON.stringify(body)}${suffix}`;
}

function compactStrategySnapshot(blueprint: StrategyBlueprint): string {
  const family = blueprint.strategyFamily;
  const familyText = family ? `${familyLabel(family)} (${family})` : "not selected";
  const rules = blueprint.rules ?? [];
  const risk = blueprint.risk;
  const execution = blueprint.execution;
  return [
    "STRATEGY SNAPSHOT:",
    `- name: ${blueprint.name || "(unnamed)"}`,
    `- family: ${familyText}`,
    `- type tags: ${(blueprint.strategyType ?? []).join(", ") || "none"}`,
    `- confidence: ${typeof blueprint.confidence === "number" ? `${blueprint.confidence}%` : "unknown"}`,
    `- rules: ${rules.length} total, ${(blueprint.compilableRuleIds ?? []).length} compilable, ${(blueprint.subjectiveRuleIds ?? []).length} need work`,
    `- execution: symbol=${execution?.symbol ?? "ANY"}, setupTF=${execution?.setupTimeframe ?? "?"}, entryTF=${execution?.entryTimeframe ?? "?"}, spread=${execution?.spreadFilterPoints ?? "?"} points`,
    `- risk: risk=${risk?.riskPercent ?? "?"}%, RR=${risk?.rewardRisk ?? "?"}, maxTrades=${risk?.maxOpenTrades ?? "?"}, BE=${risk?.breakevenEnabled ? "on" : "off"}`,
    blueprint.summary ? `- summary: ${blueprint.summary}` : "",
    blueprint.strategyNotes ? `- strategy notes: ${blueprint.strategyNotes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function compactBrainContext(blueprint: StrategyBlueprint): string {
  const fb = blueprint.fourBrain;
  if (!fb) return "4-BRAIN CONFIG: none";
  const rows = [
    ["Direction", fb.direction],
    ["Setup", fb.setup],
    ["Execution", fb.execution],
  ] as const;
  return [
    "4-BRAIN CONFIG:",
    ...rows.map(([label, brain]) => {
      if (!brain) return `- ${label}: disabled`;
      const names = brain.modules
        .map((id) => `${MODULE_BY_ID[id]?.label ?? id} (${id})`)
        .join(" + ");
      return `- ${label}: TF=${brain.timeframe}, modules=${names || "none"}, params=${shortParams(brain.params)}`;
    }),
    fb.management ? `- Management: ${shortParams(fb.management)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function compactSelectedModulesContext(blueprint: StrategyBlueprint): string {
  const selected = selectedModuleIds(blueprint);
  if (!selected.length) return "SELECTED MODULES: none";
  const family = blueprint.strategyFamily;
  const lines = ["SELECTED MODULES (assistant can diagnose these against contracts):"];
  for (const id of selected) {
    const def = MODULE_BY_ID[id as keyof typeof MODULE_BY_ID];
    const admission = MODULE_ADMISSION[id];
    const contract = MODULE_CONTRACTS[id];
    const familyStatus = family
      ? moduleAllowedInFamily(id, family)
        ? `allowed in ${family}`
        : `outside selected family ${family}`
      : "family unknown";
    lines.push(
      `- ${id}: ${def?.label ?? id}, category=${def?.category ?? "unknown"}, admission=${admission?.status ?? "unknown"}, contract=${contract?.implementation ?? "missing"}, roles=${contract?.supportedRoles?.join("/") ?? "none"}, ${familyStatus}`,
    );
  }
  return lines.join("\n");
}

function compactModuleRegistryContext(blueprint: StrategyBlueprint): string {
  const family = blueprint.strategyFamily;
  const groups = new Map<string, string[]>();
  for (const mod of ALL_BRAIN_MODULES) {
    const allowed = family ? moduleAllowedInFamily(mod.id, family) : true;
    const label = `${mod.label} (${mod.id}${allowed ? "" : ", hidden for current family"})`;
    groups.set(mod.category, [...(groups.get(mod.category) ?? []), label]);
  }
  return [
    "AVAILABLE BUILDER MODULE REGISTRY:",
    `- strategy families: ${STRATEGY_FAMILIES.map((f) => `${f.label}=${f.id}`).join("; ")}`,
    ...[...groups.entries()].map(([category, mods]) => `- ${category}: ${mods.join(", ")}`),
  ].join("\n");
}

function compactIndicatorRegistryContext(blueprint: StrategyBlueprint): string {
  const indicatorRefs = blueprint.indicatorRefs ?? [];
  const filterRefs = blueprint.filterRefs ?? [];
  const groups = new Map<string, string[]>();
  for (const ind of INDICATOR_REGISTRY) {
    const label = `${ind.name} (${ind.id}, ${ind.via}:${ind.mql5})`;
    groups.set(ind.category, [...(groups.get(ind.category) ?? []), label]);
  }
  return [
    "BUILT-IN / SHIPPED MT5 INDICATOR REGISTRY:",
    "- These are selectable/referenceable primitives. They are not full 4-Brain modules unless wrapped by a verified contract.",
    indicatorRefs.length
      ? `- selected indicator refs: ${indicatorRefs.map((i) => `${i.name} (${i.id})`).join(", ")}`
      : "- selected indicator refs: none",
    filterRefs.length
      ? `- selected filter refs: ${filterRefs.map((f) => `${f.label} (${f.indicatorId}) @ ${f.timeframe}, params=${shortParams(f.params)}`).join("; ")}`
      : "- selected filter refs: none",
    ...[...groups.entries()].map(([category, inds]) => {
      const label =
        INDICATOR_CATEGORY_LABEL[category as keyof typeof INDICATOR_CATEGORY_LABEL] ?? category;
      return `- ${label}: ${inds.join(", ")}`;
    }),
  ].join("\n");
}

function compactAdmissionContext(selectedModules: string[]): string {
  const lines = [
    "Module admission (verified vs template-only vs detector-only):",
    ...Object.values(MODULE_ADMISSION).map(
      (m) => `- ${m.id}: ${m.status}${selectedModules.includes(m.id) ? " (selected)" : ""}`,
    ),
  ];
  const repair = buildModuleRepairPlan(selectedModules);
  if (repair.blocked.length) {
    lines.push(
      "",
      "Blocked selections:",
      ...repair.blocked.map((b) => `- ${b.label}: ${b.reason}`),
    );
  }
  if (repair.summary) {
    lines.push("", `Repair plan: ${repair.summary}`);
  }
  return lines.join("\n");
}

/** Architecture + flow + generation preview for the assistant system context. */
export function buildAssistantPlatformContext(blueprint: StrategyBlueprint): string {
  const selectedModules = selectedModuleIds(blueprint);
  const flow = resolveStrategyFlow(blueprint);
  const expectedChain = buildExpectedTradePath(blueprint);
  let generationPreview: ReturnType<typeof previewEaGeneration> | null = null;
  try {
    generationPreview = previewEaGeneration(blueprint);
  } catch {
    generationPreview = null;
  }

  const flowLines =
    flow?.steps?.map(
      (s, i) =>
        `${i + 1}. ${s.name || s.id} - role=${s.role}, module=${s.module}, TF=${s.timeframe}, event=${s.event}${
          s.dependsOn?.length ? `, after=[${s.dependsOn.map((d) => d.stepId).join(", ")}]` : ""
        }, params=${shortParams(s.params)}`,
    ) ?? [];

  return [
    "=== EA BUILDER PLATFORM CONTEXT ===",
    "",
    compactStrategySnapshot(blueprint),
    "",
    "GENERATION MODEL (current product):",
    "- Traders configure Strategy Flow (ordered module steps) or Simple 4-Brain preset.",
    "- Click Generate EA / Regen Template. The deterministic compiler picks flow_engine when all modules are verified.",
    "- flow_engine: ordered RegisterEvent timeline + EvaluateEntry gates + embedded state machines.",
    "- EA generation is template/deterministic. The AI Assistant helps interpret, debug, and suggest blueprint/code changes. It must not replace the compiler.",
    "",
    compactBrainContext(blueprint),
    "",
    "STRATEGY FLOW (resolved):",
    flowLines.length ? flowLines.join("\n") : "(no strategy flow resolved)",
    "",
    "EXPECTED TRADE CHAIN (before each trade):",
    expectedChain.length
      ? expectedChain
          .map(
            (s) =>
              `${s.order}. ${s.name} (${s.role}) - ${s.module} @ ${s.timeframe} -> ${s.event}${s.isEntry ? " [ENTRY GATE]" : ""}`,
          )
          .join("\n")
      : "(chain unavailable)",
    "",
    generationPreview
      ? [
          "GENERATION PREVIEW:",
          `- path: ${generationPreview.path ? generationPathLabel(generationPreview.path) : "blocked"} (${generationPreview.path ?? "null"})`,
          generationPreview.validationWarnings?.length
            ? `- warnings: ${generationPreview.validationWarnings.join("; ")}`
            : "- warnings: none",
        ].join("\n")
      : "GENERATION PREVIEW: unavailable (blueprint may be invalid)",
    "",
    compactSelectedModulesContext(blueprint),
    "",
    compactModuleRegistryContext(blueprint),
    "",
    compactIndicatorRegistryContext(blueprint),
    "",
    compactAdmissionContext(selectedModules),
    "",
    "DEBUGGING FLOW EAs:",
    "- [EVENT] lines in tester log = step fired (check order vs expected chain).",
    "- If only direction events appear but no setup/entry events, check direction to SM tick order (direction DetectStep runs before SM Tick on each bar).",
    "- External direction (e.g. BOS) must feed downstream state machines via gDir when needed.",
    "- gLastGate strings explain why EvaluateEntry blocked a trade.",
    "- Zero trades with many direction events usually means downstream steps never fired or entry gate blocked (direction mismatch, same-bar timestamp, expiry, risk filter).",
  ].join("\n");
}

