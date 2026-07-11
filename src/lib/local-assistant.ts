/**
 * Offline assistant - action-first replies from blueprint, flow, and tester logs.
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
  summarizeTradeAudit,
  type ExpectedTradeStep,
  type TradeAuditReport,
} from "@/lib/trade-audit";
import { generationPathLabel, previewEaGeneration } from "@/lib/generate-ea-router";
import { formatBrainChain } from "@/lib/brain-modules";
import { resolveFlowBacktestPeriod } from "@/lib/assistant-apply";
import {
  buildAssistantRepairPlan,
  repairPlanToMarkdown,
} from "@/lib/assistant-repair-plan";
import { buildRuleAudit, ruleAuditToMarkdown } from "@/lib/rule-audit";

export interface LocalAssistantInput {
  userMessage: string;
  blueprint: StrategyBlueprint;
  prompt?: string;
  code?: string;
  testerLog?: string | null;
  backtestSummary?: Record<string, unknown> | null;
  compileLog?: string | null;
  /** When true (default), skip full strategy dump unless user asks for details. */
  compact?: boolean;
}

function wantsCloudOfflineHelp(msg: string): boolean {
  return /cloud offline|cloud ai|why offline|why is cloud|anthropic|credits|api key/i.test(msg);
}

function wantsNoTradesHelp(msg: string): boolean {
  return /zero trades|no trades|why no|didn't trade|did not trade|no execution|no trade|not trade|please fix|fix it|fix this|wasn't trade|was not trade|no execution|signals but/i.test(
    msg,
  );
}

function wantsCompileHelp(msg: string): boolean {
  return /compile|metaeditor|syntax|error/i.test(msg);
}

function wantsGenerationVerdict(msg: string): boolean {
  return /bad generation|well generated|strategy was not|generation or|generated but|failure of the ea|results of bad/i.test(
    msg,
  );
}

function wantsStrategyOverview(msg: string): boolean {
  return /strategy overview|show (my )?strategy|what is my strategy|explain (my )?flow|full details|more detail/i.test(
    msg,
  );
}

function wantsWiringHelp(msg: string): boolean {
  return /align|alignment|same direction|in direction of|waiting.*(cross|bias)|higher.?tf|lower.?tf|\bh1\b.*\bm5\b|\bm5\b.*\bh1\b|direction.*(cross|entry|execute)|cross.*(direction|bias|align)|should also|must also|does not wait|not waiting/i.test(
    msg,
  );
}

function wiringVerdict(blueprint: StrategyBlueprint): string[] {
  const flow = resolveStrategyFlow(blueprint);
  const steps = flow?.steps ?? [];
  const dir = steps.find((s) => s.enabled !== false && s.role === "direction");
  const ltf = steps.filter(
    (s) =>
      s.enabled !== false &&
      (s.role === "setup" || s.role === "entry" || s.role === "confirmation") &&
      (!dir || s.timeframe.toUpperCase() !== dir.timeframe.toUpperCase()),
  );
  const lines: string[] = ["", "## Verdict", ""];

  if (!dir) {
    lines.push(
      "**No Direction step found.** Add an HTF Direction step (e.g. EMA Bias on H1), then point Setup/Entry `directionSource` at it.",
    );
    lines.push("[APPLY:{\"type\":\"regen_ea\"}]", "[ACTION:open_brains]");
    return lines;
  }

  const missingLink = ltf.filter((s) => {
    const fromStep =
      s.directionSource?.mode === "from_step" && s.directionSource.stepId === dir.id;
    const depDir = (s.dependsOn ?? []).some((d) => d.stepId === dir.id);
    return !fromStep && !depDir;
  });

  lines.push(
    `**Intended rule:** ${dir.timeframe} ${dir.module.toUpperCase()} Direction (${dir.event}) sets bias. Lower-TF crosses/entries must fire **only in that same direction**.`,
  );
  lines.push("");
  lines.push(
    `- Direction: **${dir.name || dir.id}** (${dir.timeframe} · ${dir.event})`,
  );
  if (ltf.length) {
    lines.push(
      `- Lower TF steps: ${ltf.map((s) => `${s.name || s.id} (${s.timeframe} · ${s.event})`).join("; ")}`,
    );
  }

  if (missingLink.length) {
    lines.push(
      "",
      `**Gap:** ${missingLink.map((s) => s.name || s.id).join(", ")} are not linked to the Direction step via \`directionSource\` / dependsOn.`,
    );
    lines.push(
      "In Advanced Flow, set each Setup/Entry **direction source** to the H1 Direction step (or Regenerate so the adapter wires `from_step`).",
    );
  } else {
    lines.push(
      "",
      "**Blueprint already links lower TF → Direction.** Regenerated flow EAs tick the LTF EMA SM with `gDir[direction]` so M5 crosses opposite to H1 bias are ignored, and entry gates reject direction mismatches.",
    );
  }

  lines.push(
    "",
    "**Do now:** Regenerate the EA, recompile, backtest with **InpAudit=true**. Opposite-direction M5 crosses should show gate blocks, not trades.",
  );
  lines.push('[APPLY:{"type":"regen_ea"}]', "[ACTION:open_brains]", "[ACTION:open_backtest]");
  return lines;
}

function stepEventCounts(
  expected: ExpectedTradeStep[],
  parsed: TradeAuditReport | null,
): Map<string, number> {
  const byStep = new Map<string, number>();
  if (!parsed) return byStep;
  for (const ev of parsed.flowEvents) {
    byStep.set(ev.stepName, (byStep.get(ev.stepName) ?? 0) + 1);
  }
  for (const step of expected) {
    if (!byStep.has(step.name)) byStep.set(step.name, 0);
  }
  return byStep;
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
        `${i + 1}. **${s.name || s.id}** - ${s.role} · ${s.module} @ ${s.timeframe} · ${s.event}`,
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
    lines.push("", "**Compiler path:** blocked - fix validation errors in Configure first.");
  }

  return lines;
}

function buildTradeVerdict(
  blueprint: StrategyBlueprint,
  testerLog?: string | null,
  backtestSummary?: Record<string, unknown> | null,
): { verdict: string[]; evidence: string[] } {
  const expected = buildExpectedTradePath(blueprint);
  const parsed = testerLog?.trim() ? parseTesterLogForTradeAudit(testerLog) : null;
  const summary = summarizeTradeAudit(expected, parsed);
  const trades =
    typeof backtestSummary?.totalTrades === "number"
      ? backtestSummary.totalTrades
      : parsed?.tradesOpened;
  const flowPeriod = resolveFlowBacktestPeriod(blueprint);
  const verdict: string[] = ["", "## Verdict", ""];
  const evidence: string[] = [];

  if (!testerLog?.trim()) {
    verdict.push(
      `**No tester log yet.** Run backtest on **${flowPeriod}** with **InpAudit=true**, then ask again.`,
    );
    return { verdict, evidence };
  }

  if (!parsed?.hasAuditMarkers) {
    verdict.push(
      "**No audit markers in log.** Regenerate EA, enable **InpAudit**, recompile, and re-backtest.",
    );
    return { verdict, evidence };
  }

  const byStep = stepEventCounts(expected, parsed);
  const entryStep = expected.find((s) => s.isEntry);
  const entryCount = entryStep ? (byStep.get(entryStep.name) ?? 0) : 0;
  const dirCount = [...byStep.entries()].find(([n]) => /direction/i.test(n))?.[1] ?? 0;
  const setupCount = [...byStep.entries()].find(([n]) => /setup/i.test(n))?.[1] ?? 0;

  if (typeof trades === "number" && trades > 0) {
    verdict.push(
      `**Trades opened: ${trades}.** Review R:R, period, and sample size - compiler path looks alive.`,
    );
    return { verdict, evidence: buildTradeEvidence(expected, parsed, summary) };
  }

  if (parsed.dominantBlock) {
    verdict.push(
      `**Signals fired, but entry was blocked:** ${parsed.dominantBlock}.`,
      "Chart markers can appear without **OpenTrade()** - check the gate line in the tester log.",
    );
    evidence.push(...buildTradeEvidence(expected, parsed, summary));
    return { verdict, evidence };
  }

  if (entryStep && entryCount === 0) {
    verdict.push(
      `**Entry never fired** (${entryStep.event}). Direction **${dirCount}x** · Setup **${setupCount}x** · Entry **0x**.`,
      "The EA never passed the final gate - no order was sent.",
    );
    evidence.push(...buildTradeEvidence(expected, parsed, summary));
    return { verdict, evidence };
  }

  if (setupCount === 0 && dirCount > 0) {
    verdict.push(
      "**Direction logged, but setup never fired.** Check bias wiring, step order, or regenerate after flow changes.",
    );
    evidence.push(...buildTradeEvidence(expected, parsed, summary));
    return { verdict, evidence };
  }

  const obsFlow = (summary.observed as { flowEvents?: number } | null)?.flowEvents;
  verdict.push(
    `**0 trades** with **${obsFlow ?? parsed.flowEvents.length}** flow event(s). See evidence below or re-ask with a log excerpt.`,
  );
  evidence.push(...buildTradeEvidence(expected, parsed, summary));
  return { verdict, evidence };
}

function buildTradeEvidence(
  expected: ExpectedTradeStep[],
  parsed: TradeAuditReport,
  summary: ReturnType<typeof summarizeTradeAudit>,
): string[] {
  const lines: string[] = ["", "## Evidence", ""];
  const obs = summary.observed as {
    flowEvents?: number;
    tradesOpened?: number;
    dominantBlock?: string | null;
  } | null;

  if (obs) {
    lines.push(
      `Flow events: **${obs.flowEvents ?? 0}** · Trades opened: **${obs.tradesOpened ?? 0}**`,
    );
    if (obs.dominantBlock) lines.push(`Dominant gate block: **${obs.dominantBlock}**`);
  }

  const byStep = stepEventCounts(expected, parsed);
  if (byStep.size) {
    lines.push("", "**Events in log:**");
    for (const [name, count] of byStep) {
      lines.push(`- ${name}: ${count}x`);
    }
    const missing = expected.filter((s) => (byStep.get(s.name) ?? 0) === 0);
    if (missing.length) {
      lines.push("", "**Steps never fired:**");
      for (const m of missing) {
        lines.push(`- **${m.name}** (${m.event})${m.isEntry ? " ← entry gate" : ""}`);
      }
    }
  }

  if (parsed.gateBlocks.length) {
    lines.push("", "**Top gate blocks:**");
    for (const b of parsed.gateBlocks.slice(0, 5)) {
      lines.push(`- ${b.reason}: ${b.count}x`);
    }
  }

  return lines;
}

function cloudOfflineVerdict(): string[] {
  return [
    "",
    "## Verdict",
    "",
    "**Cloud AI is unavailable** - server could not reach Anthropic (key, credits, or timeout).",
    "Offline diagnosis below still works from your blueprint and tester log.",
    "",
    "## Why offline?",
    "",
    "- **ANTHROPIC_API_KEY** missing/wrong on Netlify, or",
    "- API credits exhausted, or",
    "- Request failed (timeout / prompt too large).",
    "",
    "Your Anthropic console balance ≠ the key on the deploy server.",
  ];
}

function compileVerdict(compileLog?: string | null): { verdict: string[]; evidence: string[] } {
  const verdict: string[] = ["", "## Verdict", ""];
  const evidence: string[] = [];
  if (!compileLog?.trim()) {
    verdict.push("**No compile log.** Open Backtest → **Compile EA**.");
    verdict.push("[ACTION:open_backtest]");
    return { verdict, evidence };
  }
  const errors = compileLog
    .split("\n")
    .filter((l) => /error/i.test(l))
    .slice(0, 8);
  if (errors.length) {
    verdict.push(`**Compile failed** - ${errors.length} error line(s) in the last log.`);
    evidence.push("", "## Evidence", "", ...errors.map((e) => `- ${e.trim()}`));
  } else {
    verdict.push("**No compile errors** in the last log snippet.");
  }
  verdict.push("[ACTION:open_code]");
  return { verdict, evidence };
}

/** Deterministic reply when cloud ea-chat is unavailable. */
export function answerLocalAssistant(input: LocalAssistantInput): string {
  const msg = input.userMessage.trim();
  const compact = input.compact !== false;
  const repairPlan = buildAssistantRepairPlan({
    blueprint: input.blueprint,
    code: input.code,
    compileLog: input.compileLog,
    testerLog: input.testerLog,
    backtestSummary: input.backtestSummary,
  });
  const ruleAudit = buildRuleAudit({
    blueprint: input.blueprint,
    testerLog: input.testerLog,
  });

  const lines: string[] = [
    compact
      ? "*(Offline assistant - verdict from your log and blueprint. Use **Apply now** below.)*"
      : "*(Offline assistant - built from your blueprint, code, and tester logs.)*",
  ];

  if (wantsCloudOfflineHelp(msg)) {
    lines.push(...cloudOfflineVerdict());
    lines.push(...repairPlanToMarkdown(repairPlan));
  } else if (wantsWiringHelp(msg)) {
    lines.push(...wiringVerdict(input.blueprint));
    lines.push(...ruleAuditToMarkdown(ruleAudit));
  } else if (wantsCompileHelp(msg)) {
    const { verdict, evidence } = compileVerdict(input.compileLog);
    lines.push(...verdict, ...repairPlanToMarkdown(repairPlan), ...evidence);
  } else if (wantsGenerationVerdict(msg) || wantsNoTradesHelp(msg) || input.testerLog?.trim()) {
    const { verdict, evidence } = buildTradeVerdict(
      input.blueprint,
      input.testerLog,
      input.backtestSummary,
    );
    lines.push(
      ...verdict,
      ...ruleAuditToMarkdown(ruleAudit),
      ...repairPlanToMarkdown(repairPlan),
      ...evidence,
    );
  } else {
    lines.push(
      "",
      "## Verdict",
      "",
      "Ask about **H1↔M5 alignment**, **no trades**, **compile errors**, or **cloud offline** — or run a backtest with **InpAudit=true**.",
    );
    lines.push(...ruleAuditToMarkdown(ruleAudit));
  }

  if (!input.code?.trim() && repairPlan.layer !== "generation") {
    lines.push("", "- **Generate EA** first.", `[ACTION:regen_template]`);
  }

  if (!compact || wantsStrategyOverview(msg)) {
    lines.push("", "---", "", ...strategyOverview(input.blueprint, input.prompt));
    if (input.code?.trim()) {
      lines.push("", `**Generated EA:** ${input.code.split("\n").length} lines on file.`);
    }
  }

  if (compact) {
    lines.push("", "*Ask **-show strategy overview-** for full flow details.*");
  } else {
    lines.push(
      "",
      "When cloud AI is restored, I can discuss edits interactively. For now use **Apply now** or **Configure → Regenerate EA**.",
    );
  }

  return lines.join("\n");
}
