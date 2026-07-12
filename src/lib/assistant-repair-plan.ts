/**
 * Deterministic repair planner for the in-app assistant.
 *
 * This does not edit strategy code. It classifies the current evidence into a
 * safe platform action so the assistant stops guessing when traders report
 * broken entries, no trades, compile failures, or missing module support.
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import {
  resolveFlowBacktestPeriod,
  type AssistantApplyFix,
  looksLikeHtfLtfMisalignment,
  looksLikeSameBarCollision,
  looksLikeSetupExpiryIssue,
  looksLikeSilentZoneSetup,
} from "@/lib/assistant-apply";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
  validateTradeSequences,
  type ExpectedTradeStep,
  type TradeAuditReport,
} from "@/lib/trade-audit";
import { buildModuleRepairPlan, MODULE_ADMISSION } from "@/lib/module-admission";
import { previewEaGeneration, resolveStrategyFlow } from "@/lib/generate-ea-router";
import { validateGeneratedExecutionParity } from "@/lib/semantic-execution-validator";

export type AssistantRepairLayer =
  | "missing_evidence"
  | "module_contract"
  | "strategy_flow"
  | "generation"
  | "compile"
  | "tester"
  | "risk_filter"
  | "working";

export type AssistantRepairAction =
  | "regen_template"
  | "open_brains"
  | "open_code"
  | "open_backtest"
  | "open_modules"
  | "download_tester_log";

export interface AssistantRepairPlan {
  layer: AssistantRepairLayer;
  title: string;
  reasons: string[];
  apply?: AssistantApplyFix;
  action: AssistantRepairAction;
  verify: string;
}

function selectedModuleIds(blueprint: StrategyBlueprint): string[] {
  const flow = blueprint.strategyFlow?.steps?.map((s) => s.module) ?? [];
  const fb = blueprint.fourBrain;
  const brains = fb
    ? [
        ...(fb.direction?.modules ?? []),
        ...(fb.setup?.modules ?? []),
        ...(fb.execution?.modules ?? []),
      ]
    : [];
  return [...new Set([...flow, ...brains].filter(Boolean))];
}

function compileHasErrors(log?: string | null): boolean {
  if (!log?.trim()) return false;
  return log.split(/\r?\n/).some((line) => /\berror\b/i.test(line));
}

function detectTesterPeriodMismatch(
  blueprint: StrategyBlueprint,
  testerLog?: string | null,
): string | null {
  const expected = resolveFlowBacktestPeriod(blueprint).toUpperCase();
  if (!testerLog?.trim()) return null;
  const m = testerLog.match(/"period"\s*:\s*"(M\d+|H\d+|D\d+|W\d+)"/i);
  const actual = m?.[1]?.toUpperCase();
  if (actual && actual !== expected) return expected;
  if (/tester.*\bM5\b/i.test(testerLog) && expected === "M30") return expected;
  return null;
}

const ZONE_MODULES = new Set([
  "fvg",
  "order_block",
  "ob_fvg",
  "liqsweep",
  "breaker_block",
  "unicorn",
  "snr",
  "gap_snr",
  "rejection",
  "zone_liq",
  "fvg_inversion",
]);

function stepEventCounts(
  expected: ExpectedTradeStep[],
  parsed: TradeAuditReport,
): Map<string, number> {
  const byStep = new Map<string, number>();
  for (const ev of parsed.flowEvents) {
    byStep.set(ev.stepName, (byStep.get(ev.stepName) ?? 0) + 1);
  }
  for (const step of expected) {
    if (!byStep.has(step.name)) byStep.set(step.name, 0);
  }
  return byStep;
}

/** Setup/confirmation silent while entry (or other) still logs — regen cannot invent zone hits. */
function detectSilentZoneUpstream(
  expected: ExpectedTradeStep[],
  parsed: TradeAuditReport,
): { silent: ExpectedTradeStep[]; entryCount: number } | null {
  if (!expected.length) return null;
  const byStep = stepEventCounts(expected, parsed);
  const silent = expected.filter(
    (s) =>
      !s.isEntry &&
      (s.role === "setup" || s.role === "filter" || s.role === "confirmation") &&
      ZONE_MODULES.has(s.module) &&
      (byStep.get(s.name) ?? 0) === 0,
  );
  if (!silent.length) return null;
  const entry = expected.find((s) => s.isEntry);
  const entryCount = entry ? (byStep.get(entry.name) ?? 0) : 0;
  const anyHot = [...byStep.values()].some((n) => n > 0);
  if (entryCount === 0 && !anyHot) return null;
  return { silent, entryCount };
}

export function buildAssistantRepairPlan(input: {
  blueprint: StrategyBlueprint;
  code?: string | null;
  compileLog?: string | null;
  testerLog?: string | null;
  backtestSummary?: Record<string, unknown> | null;
  userMessage?: string | null;
}): AssistantRepairPlan {
  const { blueprint, code, compileLog, testerLog, backtestSummary, userMessage } = input;
  const expectedPeriod = resolveFlowBacktestPeriod(blueprint).toUpperCase();
  const moduleIds = selectedModuleIds(blueprint);
  const moduleRepair = buildModuleRepairPlan(moduleIds);
  const alignmentComplaint =
    looksLikeHtfLtfMisalignment(userMessage ?? "") ||
    looksLikeHtfLtfMisalignment(testerLog ?? "");
  const sameBarComplaint =
    looksLikeSameBarCollision(userMessage ?? "") || looksLikeSameBarCollision(testerLog ?? "");
  const expiryComplaint =
    looksLikeSetupExpiryIssue(userMessage ?? "") || looksLikeSetupExpiryIssue(testerLog ?? "");
  const silentZoneComplaint = looksLikeSilentZoneSetup(
    `${userMessage ?? ""}\n${testerLog ?? ""}`,
  );

  if (moduleRepair.blocked.length) {
    return {
      layer: "module_contract",
      title: "Selected module capability is blocked",
      reasons: moduleRepair.blocked
        .slice(0, 4)
        .map((b) => `${b.label}: ${b.reason}`),
      action: "open_modules",
      verify: "Select a verified module/contract or add the missing module contract before regenerating.",
    };
  }

  const notVerified = moduleIds.filter((id) => MODULE_ADMISSION[id]?.status === "detector_only");
  if (notVerified.length) {
    return {
      layer: "module_contract",
      title: "A selected detector is not admitted for EA building",
      reasons: notVerified.map((id) => `${id} is detector-only, not a trusted EA builder contract.`),
      action: "open_modules",
      verify: "Promote the detector to a verified builder contract or replace it with a verified module.",
    };
  }

  if (!code?.trim()) {
    return {
      layer: "generation",
      title: "No generated EA code yet",
      reasons: ["The assistant cannot repair runtime behavior before an EA exists."],
      apply: { type: "regen_ea" },
      action: "regen_template",
      verify: "After regeneration, compile and run a report backtest.",
    };
  }

  try {
    const preview = previewEaGeneration(blueprint);
    const flow = resolveStrategyFlow(blueprint);
    if (preview.path && flow) {
      const parity = validateGeneratedExecutionParity({
        blueprint,
        flow,
        code,
        path: preview.path,
      });
      if (!parity.ok) {
        return {
          layer: "generation",
          title: "The saved EA does not match the configured strategy",
          reasons: parity.errors,
          apply: { type: "regen_ea" },
          action: "regen_template",
          verify:
            "Regenerate from the blueprint, compile, then confirm each configured event appears in the audit log.",
        };
      }
    }
  } catch (error) {
    return {
      layer: "generation",
      title: "The saved EA could not be checked against the blueprint",
      reasons: [error instanceof Error ? error.message : "Semantic validation failed."],
      action: "open_code",
      verify: "Regenerate from the blueprint and compile before running another backtest.",
    };
  }

  if (compileHasErrors(compileLog)) {
    return {
      layer: "compile",
      title: "The EA has compile errors",
      reasons: compileLog!
        .split(/\r?\n/)
        .filter((line) => /\berror\b/i.test(line))
        .slice(0, 4)
        .map((line) => line.trim()),
      apply: { type: "regen_ea" },
      action: "regen_template",
      verify: "Compile again. If the same error remains, inspect Code and open a developer/module issue.",
    };
  }

  const periodFix = detectTesterPeriodMismatch(blueprint, testerLog);
  if (periodFix) {
    return {
      layer: "tester",
      title: "Backtest ran on the wrong timeframe",
      reasons: [`Strategy entry timeframe is ${expectedPeriod}, but the tester log shows a different period.`],
      apply: { type: "set_backtest_period", period: periodFix },
      action: "open_backtest",
      verify: `Run the report backtest again on ${periodFix}.`,
    };
  }

  // Runtime evidence first: if the trader already has a tester log, diagnose it
  // before generation-preview blockers. Preview still matters when regenerating.
  if (testerLog?.trim()) {
    const parsed = parseTesterLogForTradeAudit(testerLog);
    if (!parsed.hasAuditMarkers) {
      return {
        layer: "tester",
        title: "Backtest log has no EA audit markers",
        reasons: [
          "The log does not show [EVENT], [GATE], or trade audit lines, so internal state cannot be verified.",
        ],
        apply: { type: "regen_ea" },
        action: "regen_template",
        verify:
          "Regenerate, compile, and rerun with InpAudit=true so the assistant can read the gate decisions.",
      };
    }

    const sequenceProof = validateTradeSequences(blueprint, parsed);
    if (sequenceProof.verdict === "fail") {
      return {
        layer: "strategy_flow",
        title: "Backtest trades violated the configured event sequence",
        reasons: sequenceProof.violations
          .slice(0, 6)
          .map((violation) => `Trade ${violation.tradeIndex}: ${violation.message}`),
        apply: { type: "fix_flow_wiring" },
        action: "open_backtest",
        verify:
          "Apply the flow repair, regenerate, compile, and rerun until every audited trade passes.",
      };
    }

    const expected = buildExpectedTradePath(blueprint);
    const silentZone = detectSilentZoneUpstream(expected, parsed);
    if (silentZone || silentZoneComplaint) {
      const names =
        silentZone?.silent.map((s) => `${s.name} (${s.event})`).join(", ") ??
        "Setup/Confirmation zone step(s)";
      return {
        layer: "strategy_flow",
        title: "Setup never armed — Entry signals are orphaned",
        reasons: [
          `${names} logged 0 events in the tester log.`,
          silentZone && silentZone.entryCount > 0
            ? `Entry still fired ${silentZone.entryCount}x, so the robot is alive — regenerating will not create Order Block retests that are not in the price data.`
            : "Regenerating the EA alone cannot invent zone retests.",
          "Likely causes: Setup waits on OB_RETESTED (rare), two Order Block gates on the same TF, or displacement params too strict.",
        ],
        apply: { type: "fix_silent_zone_setup" },
        action: "open_brains",
        verify:
          "Apply the silent-Setup fix (arm on OB_CREATED, drop duplicate Confirmation, loosen dispMult), compile, retest with InpAudit=true, confirm Setup events appear before Entry.",
      };
    }

    const totalTrades =
      typeof backtestSummary?.totalTrades === "number"
        ? backtestSummary.totalTrades
        : parsed.tradesOpened;

    if (alignmentComplaint || sameBarComplaint || expiryComplaint || /not before entry/i.test(testerLog ?? "")) {
      const preferEma = alignmentComplaint && !sameBarComplaint && !expiryComplaint;
      return {
        layer: "strategy_flow",
        title: preferEma
          ? "HTF↔LTF EMA alignment is not enforced the way the trader expects"
          : "Strategy Flow wiring needs a one-click repair",
        reasons: [
          totalTrades > 0
            ? `Trades opened (${totalTrades}) while timing/alignment/setup looks wrong.`
            : "Trader reports entries that do not wait for the intended Direction → Setup → Entry chain.",
          sameBarComplaint
            ? "Setup and Entry appear on the same bar — entry should use relation=after."
            : "Plain regen_ea is not enough when Configure wiring already matches the last generated code.",
          expiryComplaint ? "Setup expiry / arming looks wrong for zone modules." : "",
        ].filter(Boolean),
        apply: preferEma
          ? { type: "fix_htf_ltf_ema_alignment" }
          : { type: "fix_flow_wiring" },
        action: "open_brains",
        verify:
          "Apply the wiring fix, compile, backtest with InpAudit=true, confirm the event chain fires in order.",
      };
    }

    if (totalTrades > 0) {
      return {
        layer: "working",
        title: "The EA opened trades",
        reasons: [
          `Trades opened: ${totalTrades}. Next repair should compare entry locations against the strategy rules.`,
        ],
        action: "download_tester_log",
        verify: "Attach a chart screenshot or tester log section for wrong-entry diagnosis.",
      };
    }

    if (parsed.dominantBlock) {
      const riskLike = /spread|max open|stop loss|lot size|invalid stop|too close/i.test(
        parsed.dominantBlock,
      );
      const sessionLike = /outside session|session filter|trading time/i.test(
        parsed.dominantBlock,
      );
      if (sessionLike) {
        return {
          layer: "risk_filter",
          title: "Session filter blocked new entries",
          reasons: parsed.gateBlocks.slice(0, 4).map((b) => `${b.reason}: ${b.count}x`),
          action: "open_brains",
          apply: { type: "set_time_filter", enabled: false },
          verify:
            "Widen or disable Trading Schedule under Management, Apply, compile, then retest the same period.",
        };
      }
      return {
        layer: riskLike ? "risk_filter" : "strategy_flow",
        title: `Entry gate blocked trades: ${parsed.dominantBlock}`,
        reasons: parsed.gateBlocks.slice(0, 4).map((b) => `${b.reason}: ${b.count}x`),
        action: riskLike ? "open_brains" : "open_brains",
        apply: riskLike ? undefined : { type: "fix_flow_wiring" },
        verify: riskLike
          ? "Adjust risk/spread/max stop settings, then rerun the same backtest."
          : "Apply the wiring fix (not a plain regen), compile, and verify the expected event chain fires in order.",
      };
    }

    const entry = expected.find((s) => s.isEntry);
    if (entry && parsed.flowEvents.every((e) => e.stepName !== entry.name)) {
      return {
        layer: "strategy_flow",
        title: "Entry step never fired",
        reasons: [
          `Expected entry step '${entry.name}' with event '${entry.event}', but it did not appear in the tester events.`,
        ],
        apply: { type: "fix_flow_wiring" },
        action: "open_brains",
        verify: "Apply flow wiring, rebuild, and confirm the entry step appears before any order is expected.",
      };
    }

    return {
      layer: "strategy_flow",
      title: "No trade reached the final gate",
      reasons: [
        `Audit events found: ${parsed.flowEvents.length}; trades opened: ${parsed.tradesOpened}.`,
      ],
      apply: { type: "fix_flow_wiring" },
      action: "open_brains",
      verify:
        "Apply Strategy Flow wiring (or the silent-Setup fix if Setup is at 0), compile, retest with InpAudit=true.",
    };
  }

  let previewWarnings: string[] = [];
  try {
    const preview = previewEaGeneration(blueprint);
    previewWarnings = preview.validationWarnings ?? [];
    if (!preview.path) {
      return {
        layer: "strategy_flow",
        title: "Generation is blocked by the current blueprint",
        reasons: previewWarnings.length
          ? previewWarnings
          : ["No valid generation path is available."],
        action: "open_brains",
        verify: "Fix the Strategy Flow validation errors, then regenerate the EA.",
      };
    }
  } catch (error) {
    return {
      layer: "strategy_flow",
      title: "Blueprint validation failed",
      reasons: [error instanceof Error ? error.message : "The blueprint could not be validated."],
      action: "open_brains",
      verify: "Fix Configure/Strategy Flow, then regenerate and compile.",
    };
  }

  return {
    layer: "missing_evidence",
    title: "Tester log is missing",
    reasons: [
      "The assistant can see the blueprint and code, but not MT5's execution evidence yet.",
    ],
    apply: { type: "set_backtest_period", period: expectedPeriod },
    action: "open_backtest",
    verify:
      "Run report backtest, then ask the assistant again with the tester log attached automatically.",
  };
}

export function repairPlanToContext(plan: AssistantRepairPlan): string {
  return [
    "=== DETERMINISTIC REPAIR PLAN ===",
    `- layer: ${plan.layer}`,
    `- title: ${plan.title}`,
    `- reasons: ${plan.reasons.join("; ") || "none"}`,
    plan.apply ? `- one-click apply: ${JSON.stringify(plan.apply)}` : "- one-click apply: none",
    `- app action: ${plan.action}`,
    `- verify: ${plan.verify}`,
  ].join("\n");
}

export function repairPlanToMarkdown(plan: AssistantRepairPlan): string[] {
  const lines = [
    "",
    "## Repair plan",
    "",
    `**${plan.title}.**`,
    "",
    "**Why:**",
    ...plan.reasons.slice(0, 5).map((r) => `- ${r}`),
    "",
    "**Do now:**",
  ];
  if (plan.apply) {
    lines.push(`- Use the **Apply now** button: ${JSON.stringify(plan.apply)}`);
    lines.push(`[APPLY:${JSON.stringify(plan.apply)}]`);
  }
  lines.push(`- Open the matching app area: **${plan.action}**.`);
  lines.push(`[ACTION:${plan.action}]`);
  lines.push("", "**Verify after:**", `- ${plan.verify}`);
  return lines;
}
