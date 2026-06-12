/**
 * Rich platform context for the in-app EA assistant (ea-chat).
 * Keeps generation architecture + strategy flow visible to the copilot.
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import { buildModuleRepairPlan, MODULE_ADMISSION } from "@/lib/module-admission";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import { buildExpectedTradePath } from "@/lib/trade-audit";
import { generationPathLabel, previewEaGeneration } from "@/lib/generate-ea-router";

function brainModules(blueprint: StrategyBlueprint): string[] {
  const fb = blueprint.fourBrain;
  if (!fb) return [];
  return [
    ...(fb.direction?.modules ?? []),
    ...(fb.setup?.modules ?? []),
    ...(fb.execution?.modules ?? []),
  ];
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
  const selectedModules = brainModules(blueprint);
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
        `${i + 1}. ${s.name || s.id} — role=${s.role}, module=${s.module}, TF=${s.timeframe}, event=${s.event}${
          s.dependsOn?.length ? `, after=[${s.dependsOn.map((d) => d.stepId).join(", ")}]` : ""
        }`,
    ) ?? [];

  return [
    "=== EA BUILDER PLATFORM CONTEXT ===",
    "",
    "GENERATION MODEL (current product):",
    "- Traders configure Strategy Flow (ordered module steps) or Simple 4-Brain preset.",
    "- Click **Generate EA / Regen Template** — deterministic compiler picks flow_engine when all modules are verified.",
    "- flow_engine: ordered RegisterEvent timeline + EvaluateEntry gates + embedded state machines.",
    "- EA **generation** is template/deterministic. The **AI Assistant** (this chat) helps interpret, debug, and suggest blueprint/code changes — not replace the compiler.",
    "",
    "STRATEGY FLOW (resolved):",
    flowLines.length ? flowLines.join("\n") : "(no strategy flow resolved)",
    "",
    "EXPECTED TRADE CHAIN (before each trade):",
    expectedChain.length
      ? expectedChain
          .map(
            (s) =>
              `${s.order}. ${s.name} (${s.role}) — ${s.module} @ ${s.timeframe} → ${s.event}${s.isEntry ? " [ENTRY GATE]" : ""}`,
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
    compactAdmissionContext(selectedModules),
    "",
    "DEBUGGING FLOW EAs:",
    "- [EVENT] lines in tester log = step fired (check order vs expected chain).",
    "- If only direction events appear but no setup/entry events, check direction→SM tick order (direction DetectStep runs before EMASM_Tick on each bar).",
    "- External direction (e.g. BOS) must feed EMASM_Tick via gDir — direction step must fire on or before the EMA bar.",
    "- gLastGate strings explain why EvaluateEntry blocked a trade.",
    "- Zero trades with many direction events usually means downstream steps never fired or entry gate blocked (direction mismatch, same-bar timestamp, expiry).",
    "- Full module library/contracts are omitted here to save tokens; selected module contracts are attached separately when relevant.",
  ].join("\n");
}
