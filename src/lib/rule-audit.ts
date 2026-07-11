/**
 * Phase 3 — Rule Audit Engine.
 *
 * Compares the strategy's expected event chain (from Strategy Flow) against
 * MT5 tester-log evidence. Deterministic — no LLM guessing.
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
  type ExpectedTradeStep,
  type ParsedFlowEvent,
  type ParsedGateBlock,
  type TradeAuditReport,
} from "@/lib/trade-audit";

export type RuleAuditStepStatus =
  | "passed"
  | "missing"
  | "out_of_order"
  | "direction_mismatch"
  | "no_evidence";

export type RuleAuditVerdict = "pass" | "fail" | "incomplete" | "no_evidence";

export interface RuleAuditStepResult {
  order: number;
  id: string;
  name: string;
  role: string;
  module: string;
  timeframe: string;
  event: string;
  isEntry: boolean;
  status: RuleAuditStepStatus;
  observedCount: number;
  firstTime?: string;
  lastDirection?: string;
  detail: string;
}

export interface RuleAuditReport {
  verdict: RuleAuditVerdict;
  title: string;
  expectedSequence: string[];
  steps: RuleAuditStepResult[];
  orderingIssues: string[];
  directionIssues: string[];
  gateBlocks: ParsedGateBlock[];
  tradesOpened: number;
  flowEventCount: number;
  hasAuditMarkers: boolean;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Match tester [EVENT] step names to expected flow steps. */
export function matchEventsForStep(
  step: ExpectedTradeStep,
  events: ParsedFlowEvent[],
): ParsedFlowEvent[] {
  const name = normalizeName(step.name);
  const role = normalizeName(step.role);
  const tf = normalizeName(step.timeframe);
  const module = normalizeName(step.module.replace(/_/g, " "));

  return events.filter((ev) => {
    const sn = normalizeName(ev.stepName);
    if (sn === name) return true;
    if (sn.includes(name) || name.includes(sn)) return true;
    if (sn.includes(role) && sn.includes(tf)) return true;
    if (module && sn.includes(module) && sn.includes(tf)) return true;
    return false;
  });
}

function firstTime(events: ParsedFlowEvent[]): string | undefined {
  return events[0]?.time;
}

/**
 * Build a full rule audit from blueprint + optional tester log.
 * When testerLog is omitted, returns incomplete/no_evidence statuses.
 */
export function buildRuleAudit(input: {
  blueprint: StrategyBlueprint;
  testerLog?: string | null;
  parsed?: TradeAuditReport | null;
}): RuleAuditReport {
  const expected = buildExpectedTradePath(input.blueprint);
  const parsed =
    input.parsed ??
    (input.testerLog?.trim() ? parseTesterLogForTradeAudit(input.testerLog) : null);

  const expectedSequence = expected.map(
    (s) => `${s.order}. ${s.name} (${s.timeframe} · ${s.event.replace(/_/g, " ")})`,
  );

  if (!expected.length) {
    return {
      verdict: "incomplete",
      title: "No strategy flow to audit",
      expectedSequence: [],
      steps: [],
      orderingIssues: [],
      directionIssues: [],
      gateBlocks: [],
      tradesOpened: 0,
      flowEventCount: 0,
      hasAuditMarkers: false,
    };
  }

  if (!parsed?.hasAuditMarkers) {
    return {
      verdict: "no_evidence",
      title: input.testerLog?.trim()
        ? "Tester log has no audit markers"
        : "No tester log yet — run a backtest with InpAudit=true",
      expectedSequence,
      steps: expected.map((s) => ({
        order: s.order,
        id: s.id,
        name: s.name,
        role: s.role,
        module: s.module,
        timeframe: s.timeframe,
        event: s.event,
        isEntry: s.isEntry,
        status: "no_evidence" as const,
        observedCount: 0,
        detail: "No audit evidence in tester log",
      })),
      orderingIssues: [],
      directionIssues: [],
      gateBlocks: [],
      tradesOpened: 0,
      flowEventCount: 0,
      hasAuditMarkers: false,
    };
  }

  const matched = expected.map((step) => ({
    step,
    events: matchEventsForStep(step, parsed.flowEvents),
  }));

  const orderingIssues: string[] = [];
  const directionIssues: string[] = [];

  // Ordering: earlier required steps must first-fire before later ones (when both fire)
  for (let i = 0; i < matched.length; i++) {
    for (let j = i + 1; j < matched.length; j++) {
      const earlier = matched[i]!;
      const later = matched[j]!;
      if (!earlier.events.length || !later.events.length) continue;
      const tEarly = firstTime(earlier.events)!;
      const tLate = firstTime(later.events)!;
      if (tLate < tEarly) {
        orderingIssues.push(
          `${later.step.name} fired before ${earlier.step.name} (${tLate} < ${tEarly})`,
        );
      }
    }
  }

  // Entry without prior setup/direction when those exist
  const entry = matched.find((m) => m.step.isEntry || m.step.role === "entry");
  const setup = matched.find((m) => m.step.role === "setup");
  const direction = matched.find((m) => m.step.role === "direction");
  if (entry?.events.length) {
    if (setup && !setup.events.length) {
      orderingIssues.push(`Entry '${entry.step.name}' fired but setup '${setup.step.name}' never fired`);
    }
    if (direction && !direction.events.length) {
      orderingIssues.push(
        `Entry '${entry.step.name}' fired but direction '${direction.step.name}' never fired`,
      );
    }
  }

  // Direction consistency across steps that fired
  const dirs = matched
    .filter((m) => m.events.length > 0)
    .map((m) => {
      const last = m.events[m.events.length - 1]!;
      return { name: m.step.name, dir: last.direction };
    })
    .filter((d) => d.dir === "BULL" || d.dir === "BEAR");

  for (let i = 1; i < dirs.length; i++) {
    if (dirs[i]!.dir !== dirs[0]!.dir) {
      directionIssues.push(
        `Direction conflict: ${dirs[0]!.name}=${dirs[0]!.dir} vs ${dirs[i]!.name}=${dirs[i]!.dir}`,
      );
    }
  }

  const outOfOrderNames = new Set(
    orderingIssues.flatMap((msg) => {
      const hits: string[] = [];
      for (const m of matched) {
        if (msg.includes(m.step.name)) hits.push(m.step.name);
      }
      return hits;
    }),
  );

  const steps: RuleAuditStepResult[] = matched.map(({ step, events }) => {
    const count = events.length;
    let status: RuleAuditStepStatus = count > 0 ? "passed" : "missing";
    let detail =
      count > 0
        ? `Detected ${count}x${events[0]?.time ? ` (first @ ${events[0].time})` : ""}`
        : "Not detected in tester log";

    if (count > 0 && outOfOrderNames.has(step.name)) {
      status = "out_of_order";
      detail = `Fired, but sequence order failed relative to other steps`;
    }

    const lastDir = events[events.length - 1]?.direction;
    if (
      status === "passed" &&
      lastDir &&
      (lastDir === "BULL" || lastDir === "BEAR") &&
      directionIssues.some((d) => d.includes(step.name))
    ) {
      status = "direction_mismatch";
      detail = `Fired ${count}x as ${lastDir}, but conflicts with another step direction`;
    }

    return {
      order: step.order,
      id: step.id,
      name: step.name,
      role: step.role,
      module: step.module,
      timeframe: step.timeframe,
      event: step.event,
      isEntry: step.isEntry,
      status,
      observedCount: count,
      firstTime: firstTime(events),
      lastDirection: lastDir,
      detail,
    };
  });

  const missing = steps.filter((s) => s.status === "missing");
  const failed = steps.filter(
    (s) => s.status === "out_of_order" || s.status === "direction_mismatch",
  );
  const entryMissing = steps.some((s) => s.isEntry && s.status === "missing");

  let verdict: RuleAuditVerdict = "pass";
  let title = "Rule audit passed — expected chain appears in the log";

  if (missing.length || failed.length || orderingIssues.length || directionIssues.length) {
    verdict = "fail";
    if (entryMissing && missing.length === 1) {
      title = `Entry step never fired (${missing[0]!.name})`;
    } else if (orderingIssues.length) {
      title = "Event sequence violated strategy rules";
    } else if (directionIssues.length) {
      title = "Step directions conflict across the chain";
    } else if (missing.length) {
      title = `${missing.length} expected step(s) missing from tester log`;
    } else {
      title = "Rule audit found strategy-flow violations";
    }
  } else if (parsed.tradesOpened === 0 && parsed.gateBlocks.length > 0) {
    verdict = "fail";
    title = `Chain events present, but entry gate blocked trades (${parsed.dominantBlock ?? "blocked"})`;
  } else if (parsed.tradesOpened === 0) {
    verdict = "incomplete";
    title = "Expected steps fired, but no trades opened — check risk/SL filters";
  }

  return {
    verdict,
    title,
    expectedSequence,
    steps,
    orderingIssues,
    directionIssues,
    gateBlocks: parsed.gateBlocks.slice(0, 8),
    tradesOpened: parsed.tradesOpened,
    flowEventCount: parsed.flowEvents.length,
    hasAuditMarkers: true,
  };
}

export function ruleAuditToContext(audit: RuleAuditReport): string {
  const lines = [
    "=== RULE AUDIT (expected sequence vs tester evidence) ===",
    `- verdict: ${audit.verdict}`,
    `- title: ${audit.title}`,
    `- trades opened: ${audit.tradesOpened}`,
    `- flow events: ${audit.flowEventCount}`,
    "",
    "Expected sequence:",
    ...(audit.expectedSequence.length
      ? audit.expectedSequence.map((s) => `  ${s}`)
      : ["  (none)"]),
    "",
    "Backtest evidence:",
    ...audit.steps.map(
      (s) =>
        `  - ${s.name}: ${s.status}${s.observedCount ? ` (${s.observedCount}x)` : ""} — ${s.detail}`,
    ),
  ];
  if (audit.orderingIssues.length) {
    lines.push("", "Ordering issues:", ...audit.orderingIssues.map((i) => `  - ${i}`));
  }
  if (audit.directionIssues.length) {
    lines.push("", "Direction issues:", ...audit.directionIssues.map((i) => `  - ${i}`));
  }
  if (audit.gateBlocks.length) {
    lines.push(
      "",
      "Gate blocks:",
      ...audit.gateBlocks.slice(0, 5).map((b) => `  - ${b.reason}: ${b.count}x`),
    );
  }
  return lines.join("\n");
}

export function ruleAuditToMarkdown(audit: RuleAuditReport): string[] {
  const statusIcon = (s: RuleAuditStepStatus) => {
    if (s === "passed") return "✅";
    if (s === "missing") return "❌";
    if (s === "out_of_order") return "⚠️";
    if (s === "direction_mismatch") return "⚠️";
    return "⬜";
  };

  const lines = [
    "",
    "## Rule audit",
    "",
    `**${audit.title}.**`,
    "",
    "**Expected sequence:**",
    ...audit.expectedSequence.map((s) => `- ${s}`),
    "",
    "**Backtest evidence:**",
    ...audit.steps.map(
      (s) => `- ${statusIcon(s.status)} **${s.name}**: ${s.status} — ${s.detail}`,
    ),
  ];

  if (audit.orderingIssues.length) {
    lines.push("", "**Ordering issues:**", ...audit.orderingIssues.map((i) => `- ${i}`));
  }
  if (audit.directionIssues.length) {
    lines.push("", "**Direction issues:**", ...audit.directionIssues.map((i) => `- ${i}`));
  }
  if (audit.gateBlocks.length) {
    lines.push(
      "",
      "**Gate blocks:**",
      ...audit.gateBlocks.slice(0, 5).map((b) => `- ${b.reason}: ${b.count}x`),
    );
  }

  lines.push(
    "",
    `Trades opened: **${audit.tradesOpened}** · Flow events: **${audit.flowEventCount}**`,
  );
  return lines;
}
