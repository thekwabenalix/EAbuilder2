import { useMemo } from "react";
import type { StrategyBlueprint } from "@/types/blueprint";
import {
  buildExpectedTradePath,
  parseTesterLogForTradeAudit,
  type TradeAuditReport,
} from "@/lib/trade-audit";
import { resolveStrategyFlow } from "@/lib/blueprint-generation-gate";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, Shield } from "lucide-react";

function roleTone(role: string): string {
  if (role === "direction") return "text-blue-400 border-blue-500/30 bg-blue-500/10";
  if (role === "setup") return "text-violet-400 border-violet-500/30 bg-violet-500/10";
  if (role === "entry" || role === "confirmation") return "text-emerald-400 border-emerald-500/30 bg-emerald-500/10";
  return "text-muted-foreground border-border bg-muted/20";
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
    () => (testerLog?.trim() ? parseTesterLogForTradeAudit(testerLog) : null),
    [testerLog],
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
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Expected sequence</p>
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

          {parsed.dominantBlock && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
              <Shield className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-medium text-amber-300">Most common block</p>
                <p className="text-[11px] text-muted-foreground">{parsed.dominantBlock}</p>
              </div>
            </div>
          )}

          {!compact && parsed.gateBlocks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Block reasons</p>
              <div className="space-y-1">
                {parsed.gateBlocks.slice(0, 6).map((block) => (
                  <div
                    key={block.reason}
                    className="flex items-center justify-between gap-2 text-[11px] rounded border border-border/60 bg-background/30 px-2 py-1"
                  >
                    <span className="text-muted-foreground truncate">{block.reason}</span>
                    <span className="font-mono text-amber-400 shrink-0">×{block.count}</span>
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
              {parsed.tradeChains.slice(-3).reverse().map((chain, idx) => (
                <div
                  key={`${chain.line}-${idx}`}
                  className="rounded border border-emerald-500/20 bg-emerald-500/5 p-2.5 space-y-1"
                >
                  <div className="flex items-center gap-1.5 text-[11px] text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Trade opened — step chain satisfied
                  </div>
                  {chain.steps.map((step) => (
                    <p key={`${step.name}-${step.time}`} className="text-[10px] text-muted-foreground pl-5">
                      {step.name}: {step.direction} @ {step.time}
                    </p>
                  ))}
                  {chain.entry && (
                    <p className="text-[10px] font-mono text-foreground pl-5">
                      {chain.entry.side} · lots {chain.entry.lots} · SL {chain.entry.sl} · TP{" "}
                      {chain.entry.tp}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {parsed.hasAuditMarkers && parsed.tradesOpened === 0 && parsed.gateBlocks.length > 0 && (
            <div className="flex items-start gap-2 text-[11px] text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              Tester log shows gate blocks but no completed trades — check the dominant block above.
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
