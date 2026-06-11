/**
 * Structured "apply fix" payloads the assistant can emit — wired to real app actions.
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";

export type AssistantApplyFix =
  | { type: "regen_ea" }
  | { type: "set_backtest_period"; period: string }
  | { type: "save_strategy" };

const APPLY_TYPES = new Set(["regen_ea", "set_backtest_period", "save_strategy"]);

export function extractApplyMarkers(text: string): AssistantApplyFix[] {
  const fixes: AssistantApplyFix[] = [];
  for (const match of text.matchAll(/\[APPLY:(.+?)\]\s*(?:\n|$)/g)) {
    const raw = match[1]?.trim();
    if (!raw?.startsWith("{")) continue;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      const type = typeof obj.type === "string" ? obj.type : "";
      if (!APPLY_TYPES.has(type)) continue;

      if (type === "set_backtest_period" && typeof obj.period === "string") {
        const period = obj.period.trim().toUpperCase();
        if (period && !fixes.some((f) => f.type === "set_backtest_period" && f.period === period)) {
          fixes.push({ type: "set_backtest_period", period });
        }
        continue;
      }
      if (type === "regen_ea" && !fixes.some((f) => f.type === "regen_ea")) {
        fixes.push({ type: "regen_ea" });
      }
      if (type === "save_strategy" && !fixes.some((f) => f.type === "save_strategy")) {
        fixes.push({ type: "save_strategy" });
      }
    } catch {
      // ignore malformed APPLY JSON
    }
  }
  return fixes;
}

export function stripApplyMarkers(text: string): string {
  return text.replace(/^\s*\[APPLY:.+?\]\s*$/gm, "").trimEnd();
}

/** Best-effort tester period from strategy flow (entry step TF). */
export function resolveFlowBacktestPeriod(blueprint: StrategyBlueprint): string {
  const flow = resolveStrategyFlow(blueprint);
  if (flow?.steps?.length) {
    const enabled = flow.steps.filter((s) => s.enabled !== false);
    const entry = [...enabled].reverse().find((s) => s.role === "entry");
    if (entry?.timeframe) return entry.timeframe;
    const last = enabled[enabled.length - 1];
    if (last?.timeframe) return last.timeframe;
  }
  const fb = blueprint.fourBrain;
  if (fb?.execution?.timeframe) return fb.execution.timeframe;
  return blueprint.execution?.entryTimeframe || "H1";
}

export function applyFixLabel(fix: AssistantApplyFix): string {
  switch (fix.type) {
    case "regen_ea":
      return "Regenerate EA from blueprint";
    case "set_backtest_period":
      return `Set backtest period to ${fix.period}`;
    case "save_strategy":
      return "Save strategy";
  }
}
