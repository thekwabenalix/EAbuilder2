/**
 * Keep ea-chat prompts under model limits by trimming bulky attachments.
 */

import type { StrategyBlueprint } from "@/types/blueprint";
import { buildAssistantPlatformContext } from "@/lib/assistant-platform-context";
import { getModuleContract } from "@/lib/module-contracts";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
  summarizeTradeAudit,
} from "@/lib/trade-audit";

/** Rough chars-per-token for English + JSON (conservative). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

export function truncateText(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  const omitted = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n... [${label}: ${omitted.toLocaleString()} chars omitted] ...`;
}

const TESTER_AUDIT_LINE =
  /\[EVENT\]|TRADE AUDIT|\[GATE\]|SIGNAL_BLOCKED|BLOCKED:|TRADE_OPENED|EA_BUILDER_EQUITY|gLastGate|EvaluateEntry|flow_engine|SIGNAL_FIRED|ORDER_SEND|failed to/i;

/** Audit-relevant tester lines only — drops tick spam and MT5 noise. */
export function trimTesterLogForAssistant(log: string, maxChars = 36_000): string {
  const lines = log.split(/\r?\n/);
  const kept: string[] = [];
  let inAudit = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.includes("===== TRADE AUDIT =====")) inAudit = true;

    if (inAudit || TESTER_AUDIT_LINE.test(t)) kept.push(line);

    if (inAudit && t.includes("=======================")) inAudit = false;
  }

  let body = kept.length > 0 ? kept.join("\n") : log.slice(-maxChars);
  if (body.length > maxChars) {
    const head = Math.floor(maxChars * 0.45);
    const tail = maxChars - head - 80;
    body = `${body.slice(0, head)}\n\n... [middle of tester log trimmed] ...\n\n${body.slice(-tail)}`;
  }
  return body;
}

const CODE_KEY_LINE =
  /EvaluateEntry|RegisterEvent|OnTick|flow_engine|EMASM_|BOS_SM_|IFVG|InpAudit|gLastGate|\[EVENT\]|TRADE AUDIT|void OnInit|input /i;

/** Prefer header + flow/entry wiring over full generated EA source. */
export function trimCodeForAssistant(code: string, maxChars = 20_000): string {
  if (code.length <= maxChars) return code;

  const lines = code.split("\n");
  const header = lines.slice(0, 100).join("\n");
  const snippets: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (!CODE_KEY_LINE.test(lines[i]!)) continue;
    snippets.push(...lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 18)));
    snippets.push("");
  }

  const wiring = snippets.join("\n").slice(0, maxChars - header.length - 120);
  return `${header}\n\n// --- wiring excerpt (full EA truncated for chat context) ---\n${wiring}`;
}

export function compactBlueprintJson(blueprint: StrategyBlueprint): string {
  const slim: Record<string, unknown> = {
    name: blueprint.name,
    strategyFlow: blueprint.strategyFlow,
    fourBrain: blueprint.fourBrain,
    management: blueprint.strategyFlow?.management ?? blueprint.fourBrain?.management,
  };
  const audit = {
    blueprintAudit: blueprint.blueprintAudit ?? null,
    intentContract: blueprint.intentContract ?? null,
    aiWiringDiagnostics: blueprint.aiWiringDiagnostics ?? null,
  };
  return JSON.stringify({ ...slim, ...audit }, null, 2);
}

function selectedModuleIds(blueprint: StrategyBlueprint): string[] {
  const flow = blueprint.strategyFlow?.steps ?? [];
  const fromFlow = flow.map((s) => s.module).filter(Boolean);
  const fb = blueprint.fourBrain;
  const fromBrains = fb
    ? [
        ...(fb.direction?.modules ?? []),
        ...(fb.setup?.modules ?? []),
        ...(fb.execution?.modules ?? []),
      ]
    : [];
  return [...new Set([...fromFlow, ...fromBrains])];
}

function contractsForSelectedModules(moduleIds: string[]): string {
  const lines = ["MODULE CONTRACTS (selected modules only):", ""];
  for (const id of moduleIds) {
    const c = getModuleContract(id);
    if (!c) {
      lines.push(`[${id}] (no contract registered)`);
      continue;
    }
    lines.push(`[${c.id}] ${c.label} — roles: ${c.supportedRoles.join(", ")}`);
    for (const ev of c.semanticEvents.slice(0, 6)) {
      lines.push(`  ${ev.id} (${ev.roles.join("/")}) → ${ev.queryFunctions.slice(0, 3).join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildTesterSection(blueprint: StrategyBlueprint, testerLog: string | null): string {
  if (!testerLog?.trim()) return "";

  const expected = buildExpectedTradePath(blueprint);
  const parsed = parseTesterLogForTradeAudit(testerLog);
  const summary = summarizeTradeAudit(expected, parsed);
  const excerpt = trimTesterLogForAssistant(testerLog);

  return [
    "=== TRADE AUDIT SUMMARY (parsed from tester log) ===",
    JSON.stringify(summary, null, 2),
    "",
    `=== TESTER LOG EXCERPT (${testerLog.length.toLocaleString()} chars in file → audit lines below) ===`,
    excerpt,
  ].join("\n");
}

export interface AssistantChatContextInput {
  blueprint: StrategyBlueprint;
  prompt: string;
  code: string;
  compileLog: string | null;
  testerLog: string | null;
  backtestSummary: unknown;
  diagnosticContext: unknown;
  /** Smaller cap when chart screenshots are attached (vision + context must fit). */
  maxChars?: number;
}

/** Budgeted context block injected into ea-chat (avoids 200k token limit). */
export function buildAssistantChatContext(input: AssistantChatContextInput): string {
  const moduleIds = selectedModuleIds(input.blueprint);
  const parts = [
    buildAssistantPlatformContext(input.blueprint),
    moduleIds.length ? contractsForSelectedModules(moduleIds) : "",
    "",
    "=== ORIGINAL STRATEGY PROMPT ===",
    truncateText(input.prompt || "(no original prompt supplied)", 2_000, "prompt"),
    "",
    "=== STRATEGY BLUEPRINT (compact) ===",
    compactBlueprintJson(input.blueprint),
    "",
    "=== GENERATED MQL5 (excerpt) ===",
    input.code ? trimCodeForAssistant(input.code) : "(no code generated yet)",
    input.compileLog ? `\n=== LAST COMPILE LOG ===\n${truncateText(input.compileLog, 8_000, "compile log")}` : "",
    buildTesterSection(input.blueprint, input.testerLog),
    input.backtestSummary
      ? `\n=== LAST BACKTEST SUMMARY ===\n${truncateText(JSON.stringify(input.backtestSummary, null, 2), 4_000, "backtest summary")}`
      : "",
    input.diagnosticContext
      ? `\n=== RUNNER DIAGNOSTICS ===\n${truncateText(JSON.stringify(input.diagnosticContext, null, 2), 4_000, "diagnostics")}`
      : "",
  ];

  let block = parts.filter(Boolean).join("\n");
  const maxChars = input.maxChars ?? 120_000;
  if (block.length > maxChars) {
    block = truncateText(block, maxChars, "total context");
  }
  return block;
}

/** Trim chat history so follow-up turns stay within budget. */
export function trimChatMessages<T extends { role: string; content: string }>(
  messages: T[],
  maxMessages = 10,
): T[] {
  if (messages.length <= maxMessages) return messages;
  return messages.slice(-maxMessages);
}
