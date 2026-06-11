/**
 * Phase 8 — parse MT5 tester logs and blueprint flow into trade audit views.
 *
 * Flow-engine EAs emit [EVENT], ===== TRADE AUDIT =====, and gLastGate strings.
 * Blueprint assembler EAs emit [GATE] BLOCKED and SIGNAL_BLOCKED lines.
 */

import type { StrategyBlueprint, StrategyStepConfig } from "@/types/blueprint";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";

export interface ExpectedTradeStep {
  order: number;
  id: string;
  name: string;
  role: string;
  module: string;
  timeframe: string;
  event: string;
  isEntry: boolean;
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
    isEntry: step.role === "entry" || step.role === "confirmation",
  }));
}

/** Parse tester / journal log lines into structured trade audit data. */
export function parseTesterLogForTradeAudit(log: string): TradeAuditReport {
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
      const entryMatch = trimmed.match(/ENTRY\s+(BUY|SELL)\s+lots=([\d.]+)\s+SL=([\d.]+)\s+TP=([\d.]+)/i);
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

    const eventMatch = trimmed.match(/\[EVENT\]\s*(.+?)\s*\|\s*dir=(-?\d+)\s*\|\s*(.+?)(?:\s*\|\s*sl=([\d.]+))?/i);
    if (eventMatch) {
      hasAuditMarkers = true;
      flowEvents.push({
        stepName: eventMatch[1]!.trim(),
        direction: parseDirection(eventMatch[2]!),
        time: eventMatch[3]!.trim(),
        sl: eventMatch[4] ? parseFloat(eventMatch[4]) : undefined,
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

  return {
    flowEvents,
    tradeChains,
    gateBlocks,
    tradesOpened: Math.max(tradesOpened, tradeChains.length),
    equitySnapshots,
    hasAuditMarkers,
    dominantBlock: gateBlocks[0]?.reason,
  };
}

/** Compact summary for AI chat / diagnostic payloads. */
export function summarizeTradeAudit(
  expected: ExpectedTradeStep[],
  parsed: TradeAuditReport | null,
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
        }
      : null,
  };
}
