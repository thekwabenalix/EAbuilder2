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
  applyFixSilentZoneSetup,
  looksLikeSameBarCollision,
  looksLikeSetupExpiryIssue,
  looksLikeSilentZoneSetup,
} from "@/lib/assistant-flow-fixes";
import {
  applySetTimeFilter,
  type SetTimeFilterPatch,
  type TradingScheduleMode,
} from "@/lib/trading-schedule";

export type AssistantApplyFix =
  | { type: "regen_ea" }
  | { type: "set_backtest_period"; period: string }
  | { type: "save_strategy" }
  /** Patch Strategy Flow so LTF EMA waits for HTF Direction alignment, then regen. */
  | { type: "fix_htf_ltf_ema_alignment" }
  /** Universal flow wiring: direction sources, entry-after-setup, zone expiry (+ EMA extras). */
  | { type: "fix_flow_wiring" }
  /** Setup logged 0 events while Entry fired — arm on zone formation, drop duplicate OB gates. */
  | { type: "fix_silent_zone_setup" }
  /** Set Management trading schedule (TIME_SESSION_FILTER), then regen. */
  | ({ type: "set_time_filter" } & SetTimeFilterPatch);

const APPLY_TYPES = new Set([
  "regen_ea",
  "set_backtest_period",
  "save_strategy",
  "fix_htf_ltf_ema_alignment",
  "fix_flow_wiring",
  "fix_silent_zone_setup",
  "set_time_filter",
]);

function parseSetTimeFilter(obj: Record<string, unknown>): AssistantApplyFix | null {
  const patch: SetTimeFilterPatch = {};
  if (typeof obj.enabled === "boolean") patch.enabled = obj.enabled;
  if (typeof obj.mode === "string") {
    const mode = obj.mode as TradingScheduleMode;
    if (mode === "all" || mode === "presets" || mode === "custom_windows") patch.mode = mode;
  }
  if (Array.isArray(obj.sessions)) {
    patch.sessions = obj.sessions.filter((s): s is string => typeof s === "string");
  }
  if (Array.isArray(obj.windows)) {
    patch.windows = obj.windows.filter(
      (w): w is { start?: string; end?: string; startMin?: number; endMin?: number } =>
        Boolean(w) && typeof w === "object",
    ) as SetTimeFilterPatch["windows"];
  }
  if (Array.isArray(obj.days)) {
    patch.days = obj.days.filter((d): d is number => typeof d === "number");
  }
  if (typeof obj.cancelPendingOrders === "boolean") {
    patch.cancelPendingOrders = obj.cancelPendingOrders;
  }
  if (typeof obj.closeOpenPositions === "boolean") {
    patch.closeOpenPositions = obj.closeOpenPositions;
  }
  // Need at least one meaningful field (enabled false is enough)
  if (
    patch.enabled === undefined &&
    !patch.mode &&
    !(patch.sessions?.length) &&
    !(patch.windows?.length) &&
    !(patch.days?.length) &&
    patch.cancelPendingOrders === undefined &&
    patch.closeOpenPositions === undefined
  ) {
    // Default: enable London when bare set_time_filter
    patch.enabled = true;
    patch.sessions = ["london"];
    patch.mode = "presets";
  }
  return { type: "set_time_filter", ...patch };
}

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
      if (
        type === "fix_silent_zone_setup" &&
        !fixes.some((f) => f.type === "fix_silent_zone_setup")
      ) {
        fixes.push({ type: "fix_silent_zone_setup" });
      }
      if (type === "set_time_filter" && !fixes.some((f) => f.type === "set_time_filter")) {
        const fix = parseSetTimeFilter(obj);
        if (fix) fixes.push(fix);
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
    case "fix_silent_zone_setup":
      return "Fix silent Setup (arm on zone form, drop duplicate OB gate)";
    case "set_time_filter":
      if (fix.enabled === false) return "Disable trading schedule (all day)";
      if (fix.sessions?.length) return `Set trading schedule: ${fix.sessions.join(", ")}`;
      if (fix.windows?.length) return "Set custom trading hours";
      return "Set trading schedule";
  }
}

/** Apply types that rewrite the blueprint then regenerate. */
export function isBlueprintPatchApply(fix: AssistantApplyFix): boolean {
  return (
    fix.type === "fix_htf_ltf_ema_alignment" ||
    fix.type === "fix_flow_wiring" ||
    fix.type === "fix_silent_zone_setup" ||
    fix.type === "set_time_filter"
  );
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
  applyFixSilentZoneSetup,
  looksLikeSameBarCollision,
  looksLikeSetupExpiryIssue,
  looksLikeSilentZoneSetup,
  applySetTimeFilter,
};
