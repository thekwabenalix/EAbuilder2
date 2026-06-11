/**
 * Offline assistant — answers from blueprint, flow, and tester logs when cloud AI is down.
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
  summarizeTradeAudit,
} from "@/lib/trade-audit";
import { generationPathLabel, previewEaGeneration } from "@/lib/generate-ea-router";
import { formatBrainChain } from "@/lib/brain-modules";

export interface LocalAssistantInput {
  userMessage: string;
  blueprint: StrategyBlueprint;
  prompt?: string;
  code?: string;
  testerLog?: string | null;
  backtestSummary?: Record<string, unknown> | null;
  compileLog?: string | null;
}

function wantsNoTradesHelp(msg: string): boolean {
  return /zero trades|no trades|why no|didn't trade|did not trade|no execution/i.test(msg);
}

function wantsCompileHelp(msg: string): boolean {
  return /compile|metaeditor|syntax|error/i.test(msg);
}

function wantsGenerationVerdict(msg: string): boolean {
  return /bad generation|well generated|strategy was not|generation or|generated but|failure of the ea|results of bad/i.test(
    msg,
  );
}

function strategyOverview(blueprint: StrategyBlueprint, prompt?: string): string[] {
  const lines: string[] = [];
  const flow = resolveStrategyFlow(blueprint);
  const chain = buildExpectedTradePath(blueprint);
  const fb = blueprint.fourBrain;

  lines.push(`## Strategy overview`, "", `**Name:** ${blueprint.name || "Untitled"}`);

  if (prompt?.trim()) {
    lines.push("", "**Original description (excerpt):**", prompt.trim().slice(0, 400));
  }

  if (flow?.steps?.length) {
    lines.push("", "**Strategy Flow (ordered gate):**");
    for (const [i, s] of flow.steps.entries()) {
      if (s.enabled === false) continue;
      lines.push(
        `${i + 1}. **${s.name || s.id}** — ${s.role} · ${s.module} @ ${s.timeframe} · ${s.event}`,
      );
    }
  } else if (fb) {
    lines.push("", "**4-Brain preset:**", formatBrainChain(fb));
  }

  if (chain.length) {
    lines.push("", "**Expected chain before each trade:**");
    for (const step of chain) {
      lines.push(
        `${step.order}. ${step.name} (${step.role}) → ${step.event} on ${step.timeframe}${step.isEntry ? " **→ TRADE**" : ""}`,
      );
    }
  }

  const mgmt = flow?.management ?? fb?.management;
  if (mgmt) {
    lines.push(
      "",
      `**Risk management:** ${mgmt.riskPercent ?? 1}% risk · ${mgmt.rewardRisk ?? 2}R target · max ${mgmt.maxOpenTrades ?? 1} open trade(s)`,
    );
  }

  try {
    const preview = previewEaGeneration(blueprint);
    if (preview.path) {
      lines.push("", `**Compiler path:** ${generationPathLabel(preview.path)}`);
    }
    if (preview.validationWarnings?.length) {
      lines.push(`**Warnings:** ${preview.validationWarnings.join("; ")}`);
    }
  } catch {
    lines.push("", "**Compiler path:** blocked — fix validation errors in Configure first.");
  }

  return lines;
}

function noTradesSection(
  blueprint: StrategyBlueprint,
  testerLog?: string | null,
  backtestSummary?: Record<string, unknown> | null,
): string[] {
  const lines: string[] = ["", "## Why no trades?", ""];
  const expected = buildExpectedTradePath(blueprint);
  const parsed = testerLog ? parseTesterLogForTradeAudit(testerLog) : null;
  const summary = summarizeTradeAudit(expected, parsed);

  if (backtestSummary && typeof backtestSummary.totalTrades === "number") {
    lines.push(`Backtest reported **${backtestSummary.totalTrades}** trade(s).`);
  }

  if (!testerLog?.trim()) {
    lines.push(
      "No tester log attached yet. Run a report backtest with **InpAudit=true**, then open **Tester log** or ask again.",
    );
    lines.push("[ACTION:open_backtest]");
    return lines;
  }

  const obs = summary.observed as {
    flowEvents?: number;
    tradesOpened?: number;
    dominantBlock?: string | null;
    topBlocks?: Array<{ reason: string; count: number }>;
  } | null;

  if (obs) {
    lines.push(`Flow events logged: **${obs.flowEvents ?? 0}** · Trades opened: **${obs.tradesOpened ?? 0}**`);
    if (obs.dominantBlock) {
      lines.push(`Most common gate block: **${obs.dominantBlock}**`);
    }
    if (parsed?.flowEvents.length) {
      const byStep = new Map<string, number>();
      for (const ev of parsed.flowEvents) {
        byStep.set(ev.stepName, (byStep.get(ev.stepName) ?? 0) + 1);
      }
      lines.push("", "**Events seen in log:**");
      for (const [name, count] of byStep) {
        lines.push(`- ${name}: ${count}×`);
      }
      const expectedNames = new Set(expected.map((s) => s.name));
      const missing = expected.filter((s) => !byStep.has(s.name) && !s.isEntry);
      if (missing.length) {
        lines.push("", "**Steps never fired (check wiring / market conditions):**");
        for (const m of missing) {
          lines.push(`- ${m.name} (${m.event})`);
        }
      }
    }
  }

  lines.push(
    "",
    "Typical fixes: regenerate EA after flow changes, confirm each step fires in order, check direction mismatch and setup expiry.",
  );
  lines.push("[ACTION:open_backtest]");
  return lines;
}

function generationVsStrategySection(
  blueprint: StrategyBlueprint,
  testerLog?: string | null,
  backtestSummary?: Record<string, unknown> | null,
): string[] {
  const lines: string[] = ["", "## Generation vs strategy", ""];

  if (!testerLog?.trim()) {
    lines.push(
      "Need a tester log to judge this. Run a report backtest with **InpAudit=true**, then ask again.",
    );
    lines.push("[ACTION:open_backtest]");
    return lines;
  }

  const expected = buildExpectedTradePath(blueprint);
  const parsed = parseTesterLogForTradeAudit(testerLog);
  const trades = backtestSummary?.totalTrades;
  const byStep = new Map<string, number>();
  for (const ev of parsed.flowEvents) {
    byStep.set(ev.stepName, (byStep.get(ev.stepName) ?? 0) + 1);
  }

  const missingNonEntry = expected.filter((s) => !s.isEntry && !byStep.has(s.name));
  const directionOnly =
    byStep.size === 1 &&
    expected.some((s) => s.role === "direction" && byStep.has(s.name));

  if (!parsed.hasAuditMarkers) {
    lines.push(
      "**Likely generation / audit setup issue** — log has no `[EVENT]` or `TRADE AUDIT` markers.",
      "Regenerate EA, enable **InpAudit**, recompile, and rerun the backtest.",
    );
    lines.push("[ACTION:regen_template]");
    return lines;
  }

  if (missingNonEntry.length > 0 || directionOnly) {
    lines.push(
      "**Verdict:** Likely **generation / wiring** — downstream flow steps never fired.",
      "",
      "### Evidence",
    );
    if (directionOnly) {
      lines.push("- Only direction events appear; setup/confirmation/entry never logged.");
    }
    for (const m of missingNonEntry) {
      lines.push(`- Missing step: **${m.name}** (${m.event})`);
    }
    lines.push(
      "",
      "This usually means bias wiring, step order, or a regen-after-config change — not that the market rejected a working strategy.",
    );
    lines.push("[ACTION:regen_template]");
    return lines;
  }

  if (parsed.gateBlocks.length > 0 && (parsed.tradesOpened === 0 || trades === 0)) {
    const top = parsed.gateBlocks.slice(0, 3);
    lines.push(
      "**Likely strategy / gate conditions** — flow steps fire, but entry is blocked.",
      "",
      `Dominant block: **${parsed.dominantBlock ?? top[0]?.reason ?? "unknown"}**`,
    );
    for (const b of top) {
      lines.push(`- ${b.reason}: ${b.count}×`);
    }
    lines.push(
      "",
      "Generation looks structurally OK (events logged). Tune params, expiry, spread filters, or market period — or loosen confluence.",
    );
    lines.push("[ACTION:open_brains]");
    return lines;
  }

  if (parsed.tradesOpened > 0 || (typeof trades === "number" && trades > 0)) {
    lines.push(
      "**Likely strategy edge / market fit** — EA generated, chain fired, and trades opened.",
      `Trades opened (log): **${parsed.tradesOpened}**${typeof trades === "number" ? ` · backtest summary: **${trades}**` : ""}.`,
      "",
      "Poor results here point to the trading rules or period, not a broken compiler. Review R:R, filters, and sample size.",
    );
    lines.push("[ACTION:open_backtest]");
    return lines;
  }

  lines.push(
    "**Inconclusive** — audit markers present but no clear chain or blocks. Attach a shorter log excerpt or rerun with InpAudit.",
  );
  lines.push("[ACTION:open_backtest]");
  return lines;
}

function compileSection(compileLog?: string | null): string[] {
  const lines: string[] = ["", "**Compile status (offline)**"];
  if (!compileLog?.trim()) {
    lines.push("No compile log yet. Open Backtest → **Compile EA**.");
    lines.push("[ACTION:open_backtest]");
    return lines;
  }
  const errors = compileLog
    .split("\n")
    .filter((l) => /error/i.test(l))
    .slice(0, 8);
  if (errors.length) {
    lines.push("Recent errors:");
    for (const e of errors) lines.push(`- ${e.trim()}`);
  } else {
    lines.push("No explicit errors in the last compile log snippet.");
  }
  lines.push("[ACTION:open_code]");
  return lines;
}

/** Deterministic reply when cloud ea-chat is unavailable. */
export function answerLocalAssistant(input: LocalAssistantInput): string {
  const msg = input.userMessage.trim();
  const lines = [
    "*(Offline assistant — cloud AI is unavailable; this summary is built from your saved strategy, code, and logs.)*",
    "",
    ...strategyOverview(input.blueprint, input.prompt),
  ];

  if (input.code?.trim()) {
    lines.push("", `**Generated EA:** ${input.code.split("\n").length} lines of MQL5 on file.`);
  } else {
    lines.push("", "**Generated EA:** not saved yet — click **Generate EA** on the Configure tab.");
    lines.push("[ACTION:regen_template]");
  }

  if (wantsNoTradesHelp(msg)) {
    lines.push(...noTradesSection(input.blueprint, input.testerLog, input.backtestSummary));
  } else if (wantsGenerationVerdict(msg)) {
    lines.push(...generationVsStrategySection(input.blueprint, input.testerLog, input.backtestSummary));
  } else if (wantsCompileHelp(msg)) {
    lines.push(...compileSection(input.compileLog));
  } else if (input.testerLog?.trim()) {
    lines.push(...noTradesSection(input.blueprint, input.testerLog, input.backtestSummary));
  }

  lines.push(
    "",
    "When cloud AI is restored, I can discuss edits and deeper debugging. For now: adjust steps in **Configure**, **Regenerate EA**, then re-backtest.",
  );

  return lines.join("\n");
}
