import { useMemo } from "react";
import type { StrategyBlueprint } from "@/types/blueprint";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
  validateTradeSequences,
  type TradeAuditReport,
} from "@/lib/trade-audit";
import { SESSION_PRESET_LABELS } from "@/lib/trading-schedule";
import {
  buildRuleAudit,
  type RuleAuditStepStatus,
  type RuleAuditReport,
} from "@/lib/rule-audit";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Shield,
  XCircle,
  CircleDashed,
} from "lucide-react";

function roleTone(role: string): string {
  if (role === "direction") return "text-blue-400 border-blue-500/30 bg-blue-500/10";
  if (role === "setup") return "text-orange-300 border-orange-500/30 bg-orange-500/10";
  if (role === "confirmation") return "text-violet-300 border-violet-500/30 bg-violet-500/10";
  if (role === "entry") return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  return "text-muted-foreground border-border bg-muted/20";
}

function statusTone(status: RuleAuditStepStatus): string {
  if (status === "passed") return "text-emerald-400";
  if (status === "missing") return "text-rose-400";
  if (status === "out_of_order" || status === "direction_mismatch") return "text-amber-400";
  return "text-muted-foreground";
}

function StatusIcon({ status }: { status: RuleAuditStepStatus }) {
  if (status === "passed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (status === "missing") return <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" />;
  if (status === "out_of_order" || status === "direction_mismatch")
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  return <CircleDashed className="h-3.5 w-3.5 text-muted-foreground shrink-0" />;
}

function verdictBanner(audit: RuleAuditReport) {
  if (audit.verdict === "pass") {
    return "border-emerald-500/30 bg-emerald-500/5 text-emerald-300";
  }
  if (audit.verdict === "fail") {
    return "border-rose-500/30 bg-rose-500/5 text-rose-300";
  }
  if (audit.verdict === "incomplete") {
    return "border-amber-500/30 bg-amber-500/5 text-amber-300";
  }
  return "border-border bg-muted/20 text-muted-foreground";
}

export function TradeAuditPanel({
  blueprint,
  testerLog,
  compact = false,
}: {
  blueprint: StrategyBlueprint;
  testerLog?: string | null;
  compact?: boolean;
}) {
  const expected = useMemo(() => buildExpectedTradePath(blueprint), [blueprint]);
  const parsed: TradeAuditReport | null = useMemo(
    () =>
      testerLog?.trim()
        ? parseTesterLogForTradeAudit(testerLog, {
            tradingSchedule:
              blueprint.fourBrain?.management?.tradingSchedule ??
              blueprint.strategyFlow?.management?.tradingSchedule,
          })
        : null,
    [testerLog, blueprint],
  );
  const ruleAudit = useMemo(
    () => buildRuleAudit({ blueprint, testerLog, parsed }),
    [blueprint, testerLog, parsed],
  );
  const sequenceProof = useMemo(
    () => (parsed ? validateTradeSequences(blueprint, parsed) : null),
    [blueprint, parsed],
  );
  const flow = resolveStrategyFlow(blueprint);

  if (!expected.length) {
    return (
      <div className="rounded-lg border border-border bg-card/40 p-3 text-[11px] text-muted-foreground">
        No ordered strategy flow is available for trade audit. Configure a 4-Brain or Strategy Flow
        blueprint first.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card/40 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-sky-400 shrink-0" />
          <div>
            <p className="text-xs font-semibold">Trade audit</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Expected event chain before each trade
              {parsed?.hasAuditMarkers
                ? " · parsed from tester log"
                : testerLog
                  ? " · no audit markers in log yet"
                  : ""}
            </p>
          </div>
        </div>
        {flow && (
          <span className="text-[10px] px-2 py-0.5 rounded border border-border text-muted-foreground shrink-0">
            {flow.source === "user"
              ? "Advanced flow"
              : flow.source === "ai"
                ? "AI flow"
                : "4-Brain adapter"}
          </span>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Expected sequence
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {expected.map((step, index) => (
            <div key={step.id} className="flex items-center gap-1.5">
              {index > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground/50" />}
              <div
                className={`rounded-md border px-2 py-1 text-[10px] max-w-[200px] ${roleTone(step.role)}`}
                title={`${step.module} · ${step.event} · ${step.timeframe}`}
              >
                <p className="font-medium truncate">{step.name}</p>
                <p className="opacity-80 truncate">
                  {step.timeframe} · {step.event.replace(/_/g, " ")}
                </p>
              </div>
            </div>
          ))}
          <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
          <span className="text-[10px] font-medium text-emerald-400">Trade</span>
        </div>
      </div>

      {(testerLog || ruleAudit.verdict !== "no_evidence") && (
        <div className={`rounded-md border px-3 py-2 text-[11px] ${verdictBanner(ruleAudit)}`}>
          <p className="font-medium">Rule audit: {ruleAudit.title}</p>
        </div>
      )}

      {(testerLog || parsed) && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Backtest evidence
          </p>
          <div className="space-y-1.5">
            {ruleAudit.steps.map((step) => (
              <div
                key={step.id}
                className="flex items-start gap-2 rounded border border-border/60 bg-background/30 px-2.5 py-1.5"
              >
                <StatusIcon status={step.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium truncate">{step.name}</p>
                    <span className={`text-[10px] uppercase tracking-wide ${statusTone(step.status)}`}>
                      {step.status.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
          {(ruleAudit.orderingIssues.length > 0 || ruleAudit.directionIssues.length > 0) &&
            !compact && (
              <div className="space-y-1 pt-1">
                {[...ruleAudit.orderingIssues, ...ruleAudit.directionIssues].map((issue) => (
                  <div
                    key={issue}
                    className="flex items-start gap-2 text-[11px] text-amber-300"
                  >
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    {issue}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {parsed && (
        <div className="space-y-3 pt-1 border-t border-border/60">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <div className="rounded border border-border/70 bg-background/40 px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Trades audited</p>
              <p className="text-sm font-semibold">{parsed.tradesOpened}</p>
            </div>
            <div className="rounded border border-border/70 bg-background/40 px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Flow events</p>
              <p className="text-sm font-semibold">{parsed.flowEvents.length}</p>
            </div>
            <div className="rounded border border-border/70 bg-background/40 px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Gate blocks</p>
              <p className="text-sm font-semibold">
                {parsed.gateBlocks.reduce((n, b) => n + b.count, 0)}
              </p>
            </div>
            <div className="rounded border border-border/70 bg-background/40 px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground">Equity snapshots</p>
              <p className="text-sm font-semibold">{parsed.equitySnapshots}</p>
            </div>
          </div>

          {sequenceProof && sequenceProof.tradesChecked > 0 && (
            <div
              className={
                "rounded-md border px-3 py-2 " +
                (sequenceProof.verdict === "pass"
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-rose-500/30 bg-rose-500/5")
              }
            >
              <div className="flex items-start gap-2">
                {sequenceProof.verdict === "pass" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p
                    className={
                      "text-[11px] font-semibold " +
                      (sequenceProof.verdict === "pass" ? "text-emerald-300" : "text-rose-300")
                    }
                  >
                    {sequenceProof.verdict === "pass"
                      ? sequenceProof.validTrades + " trades followed the configured sequence"
                      : sequenceProof.invalidTrades +
                        " of " +
                        sequenceProof.tradesChecked +
                        " trades violated the configured sequence"}
                  </p>
                  {sequenceProof.violations.slice(0, compact ? 1 : 5).map((violation, index) => (
                    <p
                      key={violation.tradeIndex + "-" + violation.code + "-" + index}
                      className="text-[10px] text-muted-foreground mt-1"
                    >
                      Trade {violation.tradeIndex}: {violation.message}
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {parsed.dominantBlock && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <Shield className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-medium text-amber-300">Most common block</p>
                <p className="text-[11px] text-muted-foreground">{parsed.dominantBlock}</p>
              </div>
            </div>
          )}

          {parsed.tradesOpened > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Entries by broker session (approx.)
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {(
                  Object.entries(parsed.sessionBreakdown) as Array<
                    [keyof typeof parsed.sessionBreakdown, number]
                  >
                )
                  .filter(([, n]) => n > 0)
                  .map(([key, n]) => (
                    <div
                      key={key}
                      className="rounded border border-border/70 bg-background/40 px-2.5 py-1.5 flex items-center justify-between gap-2"
                    >
                      <span className="text-[10px] text-muted-foreground truncate">
                        {key === "other"
                          ? "Other / unknown"
                          : SESSION_PRESET_LABELS[key as keyof typeof SESSION_PRESET_LABELS]}
                      </span>
                      <span className="text-xs font-mono font-semibold shrink-0">{n}</span>
                    </div>
                  ))}
              </div>
              {parsed.sessionHint && (
                <p className="text-[10px] text-sky-300/90 leading-relaxed">{parsed.sessionHint}</p>
              )}
            </div>
          )}

          {!compact && parsed.gateBlocks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Block reasons
              </p>
              <div className="space-y-1">
                {parsed.gateBlocks.slice(0, 6).map((block) => (
                  <div
                    key={block.reason}
                    className="flex items-center justify-between gap-2 text-[11px] rounded border border-border/60 bg-background/30 px-2 py-1"
                  >
                    <span className="text-muted-foreground truncate">{block.reason}</span>
                    <span className="font-mono text-amber-400 shrink-0">x{block.count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!compact && parsed.tradeChains.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Recent trade chains (from log)
              </p>
              {sequenceProof?.chains
                .slice(-3)
                .reverse()
                .map((proof, idx) => {
                  const chain = parsed.tradeChains[proof.tradeIndex - 1]!;
                  return (
                  <div
                    key={chain.line + "-" + idx}
                    className={
                      "rounded border p-2.5 space-y-1 " +
                      (proof.valid
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : "border-rose-500/20 bg-rose-500/5")
                    }
                  >
                    <div
                      className={
                        "flex items-center gap-1.5 text-[11px] " +
                        (proof.valid ? "text-emerald-300" : "text-rose-300")
                      }
                    >
                      {proof.valid ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      Trade {proof.tradeIndex} - {proof.valid ? "sequence verified" : "sequence failed"}
                    </div>
                    {chain.steps.map((step) => (
                      <p
                        key={`${step.name}-${step.time}`}
                        className="text-[10px] text-muted-foreground pl-5"
                      >
                        {step.name}: {step.direction} @ {step.time}
                      </p>
                    ))}
                    {chain.entry && (
                      <p className="text-[10px] font-mono text-foreground pl-5">
                        {chain.entry.side} · lots {chain.entry.lots} · SL {chain.entry.sl} · TP{" "}
                        {chain.entry.tp}
                      </p>
                    )}
                    {proof.violations.map((violation, violationIndex) => (
                      <p
                        key={violation.code + "-" + violationIndex}
                        className="text-[10px] text-rose-300 pl-5"
                      >
                        {violation.message}
                      </p>
                    ))}
                  </div>
                  );
                })}
            </div>
          )}

          {parsed.hasAuditMarkers && parsed.tradesOpened === 0 && parsed.gateBlocks.length > 0 && (
            <div className="flex items-start gap-2 text-[11px] text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Tester log shows gate blocks but no completed trades - check the dominant block above.
            </div>
          )}

          {!parsed.hasAuditMarkers && (
            <p className="text-[11px] text-muted-foreground">
              No [EVENT] / TRADE AUDIT / [GATE] markers found. Enable InpAudit on flow EAs or
              InpDebugJournal on blueprint assembler EAs, then re-run the backtest.
            </p>
          )}
        </div>
      )}

      {!testerLog && !compact && (
        <p className="text-[11px] text-muted-foreground border-t border-border/60 pt-3">
          Run a backtest to see which steps fired and which gates blocked entries in the tester log.
        </p>
      )}
    </div>
  );
}
