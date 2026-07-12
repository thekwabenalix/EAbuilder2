/**
 * Phase 8 - parse MT5 tester logs and blueprint flow into trade audit views.
 *
 * Flow-engine EAs emit [EVENT], ===== TRADE AUDIT =====, and gLastGate strings.
 * Blueprint assembler EAs emit [GATE] BLOCKED and SIGNAL_BLOCKED lines.
 */

import type {
  StrategyBlueprint,
  StrategyStepConfig,
  StrategyStepDependency,
  StrategyStepDirectionSource,
} from "@/types/blueprint";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import {
  buildSessionBreakdownFromTimes,
  emptySessionBreakdown,
  suggestScheduleFromBreakdown,
  type SessionBreakdownCounts,
  type TradingScheduleConfig,
} from "@/lib/trading-schedule";

export interface ExpectedTradeStep {
  order: number;
  id: string;
  name: string;
  role: string;
  module: string;
  timeframe: string;
  event: string;
  isEntry: boolean;
  dependsOn?: StrategyStepDependency[];
  directionSource?: StrategyStepDirectionSource;
}

export interface ParsedFlowEvent {
  stepName: string;
  direction: "BULL" | "BEAR" | "NEUTRAL" | "UNKNOWN";
  time: string;
  sl?: number;
  line: number;
}

export interface ParsedTradeChain {
  steps: Array<{ name: string; direction: string; time: string }>;
  entry?: { side: "BUY" | "SELL"; lots: number; sl: number; tp: number };
  line: number;
}

export interface ParsedGateBlock {
  reason: string;
  count: number;
  sampleLine: number;
}

export interface TradeAuditReport {
  flowEvents: ParsedFlowEvent[];
  tradeChains: ParsedTradeChain[];
  gateBlocks: ParsedGateBlock[];
  tradesOpened: number;
  equitySnapshots: number;
  hasAuditMarkers: boolean;
  dominantBlock?: string;
  /** Broker-hour session buckets for entry times (preset approximations). */
  sessionBreakdown: SessionBreakdownCounts;
  /** Optional UX hint when entries cluster in one session. */
  sessionHint?: string | null;
}

export type TradeSequenceViolationCode =
  | "missing_entry"
  | "missing_dependency"
  | "time_relation"
  | "direction_mismatch"
  | "entry_side_mismatch";

export interface TradeSequenceViolation {
  tradeIndex: number;
  code: TradeSequenceViolationCode;
  message: string;
  stepName?: string;
  dependencyName?: string;
  line: number;
}

export interface ValidatedTradeChain {
  tradeIndex: number;
  valid: boolean;
  side?: "BUY" | "SELL";
  line: number;
  violations: TradeSequenceViolation[];
}

export interface TradeSequenceProof {
  verdict: "pass" | "fail" | "no_trades" | "no_audit";
  tradesChecked: number;
  validTrades: number;
  invalidTrades: number;
  violations: TradeSequenceViolation[];
  chains: ValidatedTradeChain[];
}

function normalizeBlockReason(raw: string): string {
  const text = raw.trim().replace(/\s+/g, " ");
  if (/no bias/i.test(text)) return "No direction bias";
  if (/no setup/i.test(text)) return "No active setup";
  if (/no exec/i.test(text)) return "No execution signal";
  if (/spread/i.test(text)) return "Spread too wide";
  if (/max trades/i.test(text)) return "Max open trades reached";
  if (/direction mismatch/i.test(text)) return "Direction mismatch between steps";
  if (/setup mismatch/i.test(text)) return "Setup direction mismatch";
  if (/not fired/i.test(text)) return "Upstream step not fired";
  if (/not before entry/i.test(text)) return "Step out of order (not before entry)";
  if (/not same bar or before entry/i.test(text)) return "Step out of order (same bar not allowed)";
  if (/not after entry bar/i.test(text)) return "Step out of order (must be after entry bar)";
  if (/setup expired/i.test(text)) return "Setup expired";
  if (/no SL/i.test(text)) return "Missing stop loss";
  if (/SL too wide/i.test(text)) return "Stop loss too wide";
  if (/lot calc|zero_lots/i.test(text)) return "Lot size calculation failed";
  if (/sl_invalid/i.test(text)) return "Invalid stop loss price";
  if (/sl_too_close/i.test(text)) return "Stop loss too close to entry";
  if (/outside session/i.test(text)) return "Outside trading session";
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function parseDirection(raw: string): ParsedFlowEvent["direction"] {
  const d = raw.trim().toUpperCase();
  if (d === "BULL" || d === "1") return "BULL";
  if (d === "BEAR" || d === "-1") return "BEAR";
  if (d === "-" || d === "0" || d === "NEUTRAL") return "NEUTRAL";
  return "UNKNOWN";
}

/** Ordered steps the EA should fire before opening a trade. */
export function buildExpectedTradePath(blueprint: StrategyBlueprint): ExpectedTradeStep[] {
  const flow = resolveStrategyFlow(blueprint);
  if (!flow?.steps?.length) return [];

  const enabled = flow.steps.filter((step) => step.enabled !== false);
  return enabled.map((step: StrategyStepConfig, index) => ({
    order: index + 1,
    id: step.id,
    name: step.name,
    role: step.role,
    module: step.module,
    timeframe: step.timeframe,
    event: step.event,
    isEntry: step.role === "entry",
    dependsOn: step.dependsOn,
    directionSource: step.directionSource,
  }));
}

function normalizedStepName(value: string): string {
  return value
    .trim()
    .replace(/inversion fair value gap/gi, "ifvg")
    .replace(/fair value gap/gi, "fvg")
    .replace(/break of structure/gi, "bos")
    .replace(/change of character/gi, "choch")
    .replace(/order block/gi, "ob")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function auditTimeValue(value: string): number | null {
  const match = value
    .trim()
    .match(/(\d{4})[.\/-](\d{2})[.\/-](\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  );
}

function dependencyRelationPasses(
  dependencyTime: string,
  stepTime: string,
  relation: StrategyStepDependency["relation"],
): boolean | null {
  const dependency = auditTimeValue(dependencyTime);
  const step = auditTimeValue(stepTime);
  if (dependency == null || step == null) return null;
  if (relation === "after") return step > dependency;
  if (relation === "same_or_after") return step >= dependency;
  return step < dependency;
}

/** Validate each completed trade against the blueprint dependency graph. */
export function validateTradeSequences(
  blueprint: StrategyBlueprint,
  parsed: TradeAuditReport,
): TradeSequenceProof {
  if (!parsed.hasAuditMarkers) {
    return {
      verdict: "no_audit",
      tradesChecked: 0,
      validTrades: 0,
      invalidTrades: 0,
      violations: [],
      chains: [],
    };
  }
  if (!parsed.tradeChains.length) {
    return {
      verdict: "no_trades",
      tradesChecked: 0,
      validTrades: 0,
      invalidTrades: 0,
      violations: [],
      chains: [],
    };
  }

  const expected = buildExpectedTradePath(blueprint);
  const expectedById = new Map(expected.map((step) => [step.id, step]));
  const expectedByName = new Map(expected.map((step) => [normalizedStepName(step.name), step]));
  const chains = parsed.tradeChains.map((chain, chainIndex): ValidatedTradeChain => {
    const tradeIndex = chainIndex + 1;
    const violations: TradeSequenceViolation[] = [];
    const observedByName = new Map(
      chain.steps.map((step) => [normalizedStepName(step.name), step]),
    );
    const observedExpected = chain.steps
      .map((step) => ({
        observed: step,
        expected: expectedByName.get(normalizedStepName(step.name)),
      }))
      .filter(
        (item): item is {
          observed: ParsedTradeChain["steps"][number];
          expected: ExpectedTradeStep;
        } => Boolean(item.expected),
      );

    const addViolation = (
      code: TradeSequenceViolationCode,
      message: string,
      stepName?: string,
      dependencyName?: string,
    ) => {
      violations.push({
        tradeIndex,
        code,
        message,
        stepName,
        dependencyName,
        line: chain.line,
      });
    };

    if (!chain.entry) {
      addViolation("missing_entry", "Trade audit chain has no BUY/SELL execution record.");
    }

    for (const { observed, expected: step } of observedExpected) {
      const dependencies = (step.dependsOn ?? []).filter((dep) => dep.required !== false);
      const direct = dependencies.filter((dep) => !dep.orGroup);
      const grouped = new Map<string, StrategyStepDependency[]>();
      for (const dependency of dependencies.filter((dep) => dep.orGroup)) {
        const group = grouped.get(dependency.orGroup!) ?? [];
        group.push(dependency);
        grouped.set(dependency.orGroup!, group);
      }

      const validateDependency = (dependency: StrategyStepDependency): boolean => {
        const expectedDependency = expectedById.get(dependency.stepId);
        if (!expectedDependency) return false;
        const observedDependency = observedByName.get(normalizedStepName(expectedDependency.name));
        if (!observedDependency) return false;
        const relationPasses = dependencyRelationPasses(
          observedDependency.time,
          observed.time,
          dependency.relation,
        );
        if (relationPasses === false) {
          addViolation(
            "time_relation",
            `${step.name} occurred at ${observed.time}, but must be ${dependency.relation.replace(/_/g, " ")} ${expectedDependency.name} at ${observedDependency.time}.`,
            step.name,
            expectedDependency.name,
          );
        }
        if (
          observed.direction !== "-" &&
          observedDependency.direction !== "-" &&
          observed.direction !== observedDependency.direction
        ) {
          addViolation(
            "direction_mismatch",
            `${step.name} is ${observed.direction}, but ${expectedDependency.name} is ${observedDependency.direction}.`,
            step.name,
            expectedDependency.name,
          );
        }
        return relationPasses !== false;
      };

      for (const dependency of direct) {
        const expectedDependency = expectedById.get(dependency.stepId);
        if (
          !expectedDependency ||
          !observedByName.has(normalizedStepName(expectedDependency.name))
        ) {
          addViolation(
            "missing_dependency",
            `${step.name} fired without required step ${expectedDependency?.name ?? dependency.stepId}.`,
            step.name,
            expectedDependency?.name,
          );
          continue;
        }
        validateDependency(dependency);
      }

      for (const group of grouped.values()) {
        const present = group.filter((dependency) => {
          const dependencyStep = expectedById.get(dependency.stepId);
          return dependencyStep
            ? observedByName.has(normalizedStepName(dependencyStep.name))
            : false;
        });
        if (!present.length) {
          const alternatives = group
            .map((dependency) => expectedById.get(dependency.stepId)?.name ?? dependency.stepId)
            .join(" or ");
          addViolation(
            "missing_dependency",
            `${step.name} fired without any required alternative: ${alternatives}.`,
            step.name,
            alternatives,
          );
        } else {
          present.forEach(validateDependency);
        }
      }

      if (step.directionSource?.mode === "from_step" && step.directionSource.stepId) {
        const source = expectedById.get(step.directionSource.stepId);
        const observedSource = source
          ? observedByName.get(normalizedStepName(source.name))
          : undefined;
        if (
          observedSource &&
          observed.direction !== "-" &&
          observedSource.direction !== "-" &&
          observed.direction !== observedSource.direction
        ) {
          addViolation(
            "direction_mismatch",
            `${step.name} direction ${observed.direction} disagrees with its source ${source!.name} (${observedSource.direction}).`,
            step.name,
            source!.name,
          );
        }
      }
    }

    const entryStep = observedExpected.find((item) => item.expected.isEntry)?.observed;
    if (chain.entry && entryStep) {
      const expectedSide =
        entryStep.direction === "BULL" ? "BUY" : entryStep.direction === "BEAR" ? "SELL" : null;
      if (expectedSide && chain.entry.side !== expectedSide) {
        addViolation(
          "entry_side_mismatch",
          `Entry event is ${entryStep.direction}, but the order opened ${chain.entry.side}.`,
          entryStep.name,
        );
      }
    }

    return {
      tradeIndex,
      valid: violations.length === 0,
      side: chain.entry?.side,
      line: chain.line,
      violations,
    };
  });

  const violations = chains.flatMap((chain) => chain.violations);
  const validTrades = chains.filter((chain) => chain.valid).length;
  return {
    verdict: violations.length ? "fail" : "pass",
    tradesChecked: chains.length,
    validTrades,
    invalidTrades: chains.length - validTrades,
    violations,
    chains,
  };
}

/** Parse tester / journal log lines into structured trade audit data. */
export function parseTesterLogForTradeAudit(
  log: string,
  options?: { tradingSchedule?: TradingScheduleConfig },
): TradeAuditReport {
  const lines = log.split(/\r?\n/);
  const flowEvents: ParsedFlowEvent[] = [];
  const tradeChains: ParsedTradeChain[] = [];
  const blockCounts = new Map<string, { count: number; sampleLine: number }>();
  let tradesOpened = 0;
  let equitySnapshots = 0;
  let hasAuditMarkers = false;

  let inTradeAudit = false;
  let currentChain: ParsedTradeChain | null = null;

  const bumpBlock = (reason: string, lineNo: number) => {
    const key = normalizeBlockReason(reason);
    const prev = blockCounts.get(key);
    blockCounts.set(key, { count: (prev?.count ?? 0) + 1, sampleLine: prev?.sampleLine ?? lineNo });
  };

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    if (trimmed.includes("===== TRADE AUDIT =====")) {
      hasAuditMarkers = true;
      inTradeAudit = true;
      currentChain = { steps: [], line: lineNo };
      return;
    }
    if (inTradeAudit && trimmed.includes("=======================")) {
      if (currentChain && (currentChain.steps.length || currentChain.entry)) {
        tradeChains.push(currentChain);
        tradesOpened += 1;
      }
      inTradeAudit = false;
      currentChain = null;
      return;
    }

    if (inTradeAudit && currentChain) {
      const stepMatch = trimmed.match(/^(.+?)\s*:\s*(BULL|BEAR|-)\s*@\s*(.+)$/i);
      if (stepMatch) {
        currentChain.steps.push({
          name: stepMatch[1]!.trim(),
          direction: stepMatch[2]!.toUpperCase(),
          time: stepMatch[3]!.trim(),
        });
        return;
      }
      const entryMatch = trimmed.match(
        /ENTRY\s+(BUY|SELL)\s+lots=([\d.]+)\s+SL=([\d.]+)\s+TP=([\d.]+)/i,
      );
      if (entryMatch) {
        currentChain.entry = {
          side: entryMatch[1]!.toUpperCase() as "BUY" | "SELL",
          lots: parseFloat(entryMatch[2]!),
          sl: parseFloat(entryMatch[3]!),
          tp: parseFloat(entryMatch[4]!),
        };
      }
      return;
    }

    const eventMatch = trimmed.match(/\[EVENT\]\s*(.+?)\s*\|\s*dir=(-?\d+)\s*\|\s*(.+)$/i);
    if (eventMatch) {
      hasAuditMarkers = true;
      const rest = eventMatch[3]!.trim();
      const slMatch = rest.match(/^(.*?)\s*\|\s*sl=([\d.]+)\s*$/i);
      const time = (slMatch ? slMatch[1]! : rest).trim();
      flowEvents.push({
        stepName: eventMatch[1]!.trim(),
        direction: parseDirection(eventMatch[2]!),
        time,
        sl: slMatch ? parseFloat(slMatch[2]!) : undefined,
        line: lineNo,
      });
      return;
    }

    if (/EA_BUILDER_EQUITY\|/.test(trimmed)) {
      hasAuditMarkers = true;
      equitySnapshots += 1;
      return;
    }

    const gateMatch = trimmed.match(/\[GATE\]\s*(?:BLOCKED[:\s]*)?(.+)/i);
    if (gateMatch) {
      hasAuditMarkers = true;
      bumpBlock(gateMatch[1]!, lineNo);
      return;
    }

    const signalBlock = trimmed.match(/SIGNAL_BLOCKED\s*\|\s*reason=([^|]+)/i);
    if (signalBlock) {
      hasAuditMarkers = true;
      bumpBlock(signalBlock[1]!, lineNo);
      return;
    }

    if (/BLOCKED:/i.test(trimmed)) {
      hasAuditMarkers = true;
      const blocked = trimmed.match(/BLOCKED:\s*(.+)/i);
      bumpBlock(blocked?.[1] ?? trimmed, lineNo);
    }

    if (/TRADE_OPENED/i.test(trimmed)) {
      hasAuditMarkers = true;
      tradesOpened += 1;
    }
  });

  const trailingChain = currentChain as ParsedTradeChain | null;
  if (trailingChain && (trailingChain.steps.length || trailingChain.entry)) {
    tradeChains.push(trailingChain);
    tradesOpened += 1;
  }

  const gateBlocks: ParsedGateBlock[] = [...blockCounts.entries()]
    .map(([reason, meta]) => ({ reason, count: meta.count, sampleLine: meta.sampleLine }))
    .sort((a, b) => b.count - a.count);

  const entryTimes = tradeChains.map((chain) => {
    const entryStep = [...chain.steps].reverse().find((s) => /entry/i.test(s.name));
    return entryStep?.time ?? chain.steps[chain.steps.length - 1]?.time ?? "";
  }).filter(Boolean);
  // Fallback: use flow events tagged as entry-like if no trade chains
  if (!entryTimes.length) {
    for (const ev of flowEvents) {
      if (/entry/i.test(ev.stepName)) entryTimes.push(ev.time);
    }
  }
  const sessionBreakdown = entryTimes.length
    ? buildSessionBreakdownFromTimes(entryTimes)
    : emptySessionBreakdown();
  const sessionHint = suggestScheduleFromBreakdown(
    sessionBreakdown,
    options?.tradingSchedule,
  );

  return {
    flowEvents,
    tradeChains,
    gateBlocks,
    tradesOpened: Math.max(tradesOpened, tradeChains.length),
    equitySnapshots,
    hasAuditMarkers,
    dominantBlock: gateBlocks[0]?.reason,
    sessionBreakdown,
    sessionHint,
  };
}

/** Compact summary for AI chat / diagnostic payloads. */
export function summarizeTradeAudit(
  expected: ExpectedTradeStep[],
  parsed: TradeAuditReport | null,
  sequenceProof?: TradeSequenceProof | null,
): Record<string, unknown> {
  return {
    expectedSteps: expected.map((s) => ({
      order: s.order,
      name: s.name,
      role: s.role,
      event: s.event,
      timeframe: s.timeframe,
      isEntry: s.isEntry,
    })),
    observed: parsed
      ? {
          hasAuditMarkers: parsed.hasAuditMarkers,
          tradesOpened: parsed.tradesOpened,
          flowEvents: parsed.flowEvents.length,
          tradeChains: parsed.tradeChains.length,
          topBlocks: parsed.gateBlocks.slice(0, 5),
          dominantBlock: parsed.dominantBlock ?? null,
          sessionBreakdown: parsed.sessionBreakdown,
          sessionHint: parsed.sessionHint ?? null,
          sequenceProof: sequenceProof
            ? {
                verdict: sequenceProof.verdict,
                tradesChecked: sequenceProof.tradesChecked,
                validTrades: sequenceProof.validTrades,
                invalidTrades: sequenceProof.invalidTrades,
                violations: sequenceProof.violations.slice(0, 20),
              }
            : null,
        }
      : null,
  };
}
