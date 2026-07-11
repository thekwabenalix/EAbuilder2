/**
 * Structured "apply fix" payloads the assistant can emit - wired to real app actions.
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import {
  applyHtfLtfEmaAlignment,
  looksLikeHtfLtfMisalignment,
} from "@/lib/assistant-htf-ltf-fix";
import {
  applyFixFlowWiring,
  looksLikeSameBarCollision,
  looksLikeSetupExpiryIssue,
} from "@/lib/assistant-flow-fixes";

export type AssistantApplyFix =
  | { type: "regen_ea" }
  | { type: "set_backtest_period"; period: string }
  | { type: "save_strategy" }
  /** Patch Strategy Flow so LTF EMA waits for HTF Direction alignment, then regen. */
  | { type: "fix_htf_ltf_ema_alignment" }
  /** Universal flow wiring: direction sources, entry-after-setup, zone expiry (+ EMA extras). */
  | { type: "fix_flow_wiring" };

const APPLY_TYPES = new Set([
  "regen_ea",
  "set_backtest_period",
  "save_strategy",
  "fix_htf_ltf_ema_alignment",
  "fix_flow_wiring",
]);

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
      if (
        type === "fix_htf_ltf_ema_alignment" &&
        !fixes.some((f) => f.type === "fix_htf_ltf_ema_alignment")
      ) {
        fixes.push({ type: "fix_htf_ltf_ema_alignment" });
      }
      if (type === "fix_flow_wiring" && !fixes.some((f) => f.type === "fix_flow_wiring")) {
        fixes.push({ type: "fix_flow_wiring" });
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
    case "fix_htf_ltf_ema_alignment":
      return "Fix H1→M5 EMA alignment in Configure";
    case "fix_flow_wiring":
      return "Fix Strategy Flow wiring (any modules)";
  }
}

/** Apply types that rewrite the blueprint then regenerate. */
export function isBlueprintPatchApply(fix: AssistantApplyFix): boolean {
  return fix.type === "fix_htf_ltf_ema_alignment" || fix.type === "fix_flow_wiring";
}

/** True when generated MQL5 already includes HTF↔LTF direction alignment gates. */
export function codeHasDirectionAlignGate(code: string | null | undefined): boolean {
  if (!code) return false;
  return (
    /entry not aligned with/i.test(code) ||
    /BLOCKED:\s*direction mismatch/i.test(code) ||
    /DIR_MISMATCH/i.test(code)
  );
}

/** Result returned when the assistant applies regen_ea. */
export type RegenEaResult = {
  ok: boolean;
  changed: boolean;
  saved: boolean;
  pathLabel: string;
  hasAlignGate: boolean;
  error?: string;
};

export {
  applyHtfLtfEmaAlignment,
  looksLikeHtfLtfMisalignment,
  applyFixFlowWiring,
  looksLikeSameBarCollision,
  looksLikeSetupExpiryIssue,
};
