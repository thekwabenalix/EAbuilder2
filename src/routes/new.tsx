import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Sparkles,
  Loader2,
  Wand2,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Edit2,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import { EXAMPLE_PROMPT } from "@/types/strategy";
import type { StrategyBlueprint } from "@/types/blueprint";
import { parseStrategy } from "@/lib/api-client";
import { enrichBlueprintWithStrategyFlow } from "@/lib/blueprint-flow-enrich";
import { createStrategy } from "@/lib/strategies";
import { toast } from "sonner";
import {
  analyzeBuildability,
  generateMql5FromBlueprintDetailed,
} from "@/lib/mql5-template-generator";
import type { BuildabilityResult } from "@/lib/mql5-template-generator";
import {
  firstBlueprintGenerationError,
  resolveStrategyFlow,
} from "@/lib/blueprint-generation-gate";
import { buildExpectedTradePath } from "@/lib/trade-audit";
import { EaGenerationError } from "@/lib/generate-ea-router";
import { toastEaGenerationSuccess } from "@/lib/ea-generation-toast";
import { setPreferredStrategyTab } from "@/lib/preferred-strategy-tab";
import { buildPlainEnglishConfirm } from "@/lib/plain-english-strategy";
import { formatBrainChain } from "@/lib/brain-modules";
import { WhenToTradeCard } from "@/components/WhenToTradeCard";
import {
  defaultTradingSchedule,
  type TradingScheduleConfig,
} from "@/lib/trading-schedule";
import { BlueprintExplanationPanel } from "@/components/BlueprintExplanationPanel";
import { GenerationPathBanner } from "@/components/GenerationPathBanner";
import { TradeAuditPanel } from "@/components/TradeAuditPanel";

export const Route = createFileRoute("/new")({
  component: StrategyBuilders,
});

const REINTERVIEW_KEY = "ea-reinterview-prompt";

type Stage = "idle" | "interviewing" | "reviewed" | "generating";

function patchBlueprintTradingSchedule(
  bp: StrategyBlueprint,
  schedule: TradingScheduleConfig,
): StrategyBlueprint {
  const next: StrategyBlueprint = { ...bp };
  if (next.fourBrain) {
    next.fourBrain = {
      ...next.fourBrain,
      management: {
        ...next.fourBrain.management,
        tradingSchedule: schedule,
      },
    };
  }
  if (next.strategyFlow) {
    next.strategyFlow = {
      ...next.strategyFlow,
      management: {
        ...next.strategyFlow.management,
        tradingSchedule: schedule,
      },
    };
  }
  return next;
}

function StrategyBuilders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<StrategyBlueprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    const saved = sessionStorage.getItem(REINTERVIEW_KEY);
    if (saved?.trim()) {
      setPrompt(saved);
      sessionStorage.removeItem(REINTERVIEW_KEY);
      toast.message("Original strategy description restored - click Interview Strategy.");
    }
  }, []);

  const busy = stage === "interviewing" || stage === "generating";

  const onInterview = async () => {
    setError(null);
    if (prompt.trim().length < 20) {
      setError("Please describe your strategy in more detail (at least 20 characters).");
      return;
    }
    if (!user) return;
    setStage("interviewing");
    setStageLabel("Interviewing strategy…");
    try {
      const { blueprint: bp } = await parseStrategy(prompt);
      setBlueprint(enrichBlueprintWithStrategyFlow(bp as StrategyBlueprint));
      setStage("reviewed");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to interview strategy. Please try again.");
      setStage("idle");
    } finally {
      setStageLabel(null);
    }
  };

  const onCreateDraft = async () => {
    if (!blueprint || !user) return;
    const generationError = firstBlueprintGenerationError(blueprint);
    if (generationError) {
      setError(generationError);
      toast.error("Fix strategy validation errors before saving.");
      return;
    }
    setError(null);
    setStage("generating");
    setStageLabel("Building your robot…");
    try {
      const result = generateMql5FromBlueprintDetailed(blueprint);
      const row = await createStrategy({
        userId: user.id,
        name: blueprint.name || "Untitled Strategy",
        prompt,
        blueprint,
        generatedCode: result.code,
      });
      toastEaGenerationSuccess(result, "Robot built");
      setPreferredStrategyTab("backtest");
      navigate({ to: "/s/$id", params: { id: row.id } });
    } catch (e: unknown) {
      setError(
        e instanceof EaGenerationError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Failed to save strategy. Please try again.",
      );
      setStage("reviewed");
    } finally {
      setStageLabel(null);
    }
  };

  const onEditPrompt = () => {
    setStage("idle");
    setBlueprint(null);
    setError(null);
    setClarificationAnswers({});
  };

  const onRefine = async () => {
    if (!blueprint) return;
    const questions = blueprint.pendingClarifications ?? [];
    const answeredPairs = questions
      .map((q, i) => {
        const ans = clarificationAnswers[i]?.trim();
        return ans ? `Q: ${q}\nA: ${ans}` : null;
      })
      .filter(Boolean);
    if (answeredPairs.length === 0) {
      toast.info("Type at least one answer before refining.");
      return;
    }
    const enrichedPrompt =
      prompt.trim() + "\n\n--- Clarifications ---\n" + answeredPairs.join("\n\n");
    setError(null);
    setStage("interviewing");
    setStageLabel("Refining interview…");
    setClarificationAnswers({});
    try {
      const { blueprint: bp } = await parseStrategy(enrichedPrompt);
      setBlueprint(enrichBlueprintWithStrategyFlow(bp as StrategyBlueprint));
      setStage("reviewed");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Refinement failed. Please try again.");
      setStage("reviewed");
    } finally {
      setStageLabel(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="New strategy"
        subtitle="Describe how you trade — we’ll turn it into a robot you can test on history"
      />

      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {stage === "idle" && (
          <div className="rounded-xl border border-border bg-card/40 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Prefer clicking modules yourself? Customize visually instead.
            </p>
            <Link
              to="/build"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline shrink-0"
            >
              Customize visually
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        {stage === "reviewed" && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider px-2">
              Review what we understood
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>
        )}

        {/* ── AI Builder form ── */}
        <div
          className={
            stage === "reviewed" ? "grid grid-cols-1 lg:grid-cols-2 gap-6 items-start" : "space-y-4"
          }
        >
          {/* LEFT: Prompt */}
          <div className="space-y-4">
            {stage !== "reviewed" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="prompt" className="text-xs">
                    Strategy description
                  </Label>
                  <Button size="sm" variant="ghost" onClick={() => setPrompt(EXAMPLE_PROMPT)}>
                    <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Use example
                  </Button>
                </div>
                <Textarea
                  id="prompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={12}
                  placeholder={
                    "Describe your strategy in plain English. For example:\n\n" +
                    "• Buy when price breaks above the previous daily high during the London session\n" +
                    "• Enter after a liquidity sweep below equal lows on H1 and a BOS to the upside on M15\n" +
                    "• Use the 50 and 200 EMA cross on H4 for trend direction, enter on M5 pullback to 50 EMA"
                  }
                  className="font-mono text-sm"
                  disabled={busy}
                />
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Strategy description</Label>
                  <Button size="sm" variant="ghost" onClick={onEditPrompt}>
                    <Edit2 className="h-3.5 w-3.5 mr-1.5" /> Edit prompt
                  </Button>
                </div>
                <div className="rounded-md border border-border bg-muted/20 p-3 max-h-64 overflow-y-auto text-xs font-mono text-muted-foreground whitespace-pre-wrap">
                  {prompt}
                </div>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <p>{error}</p>
              </div>
            )}

            {(stage === "idle" || stage === "interviewing") && (
              <div className="flex items-center gap-3">
                <Button onClick={onInterview} disabled={busy} className="min-w-[180px]">
                  {stage === "interviewing" ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      {stageLabel ?? "Interviewing…"}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-1.5" />
                      Understand my strategy
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  We’ll show what we understood before building the robot.
                </p>
              </div>
            )}

            {stage !== "reviewed" && (
              <div className="rounded-md border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Understands any strategy including:</p>
                <p>
                  Price action · ICT / SMC (order blocks, FVGs, liquidity sweeps, BOS/CHoCH) ·
                  Supply &amp; Demand · Indicators (EMA, RSI, MACD, Bollinger, ATR…) · Wyckoff ·
                  Breakout · Session · Multi-timeframe · Scalping · Grid · News trading · And more
                </p>
              </div>
            )}
          </div>

          {/* RIGHT: Interview result */}
          {stage === "reviewed" && blueprint && (
            <InterviewPanel
              blueprint={blueprint}
              onCreateDraft={onCreateDraft}
              onRefine={onRefine}
              busy={busy}
              stageLabel={stageLabel}
              clarificationAnswers={clarificationAnswers}
              onAnswerChange={(i, val) =>
                setClarificationAnswers((prev) => ({ ...prev, [i]: val }))
              }
              onTradingScheduleChange={(schedule) => {
                setBlueprint((prev) => {
                  if (!prev) return prev;
                  return patchBlueprintTradingSchedule(prev, schedule);
                });
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Interview result panel ───────────────────────────────────────────────────

function InterviewPanel({
  blueprint,
  onCreateDraft,
  onRefine,
  busy,
  stageLabel,
  clarificationAnswers,
  onAnswerChange,
  onTradingScheduleChange,
}: {
  blueprint: StrategyBlueprint;
  onCreateDraft: () => void;
  onRefine: () => void;
  busy: boolean;
  stageLabel: string | null;
  clarificationAnswers: Record<number, string>;
  onAnswerChange: (index: number, value: string) => void;
  onTradingScheduleChange: (schedule: TradingScheduleConfig) => void;
}) {
  const compilableCount = blueprint.compilableRuleIds?.length ?? 0;
  const subjectiveCount = blueprint.subjectiveRuleIds?.length ?? 0;
  const totalRules = blueprint.rules?.length ?? 0;
  const clarifications = blueprint.pendingClarifications ?? [];
  const confidence = blueprint.confidence ?? 0;
  const isFourBrain = Boolean(blueprint.fourBrain);
  const generationError = firstBlueprintGenerationError(blueprint);
  const flow = resolveStrategyFlow(blueprint);
  const tradeChain = buildExpectedTradePath(blueprint);
  const plain = buildPlainEnglishConfirm(blueprint);
  const tradingSchedule =
    blueprint.fourBrain?.management?.tradingSchedule ??
    blueprint.strategyFlow?.management?.tradingSchedule ??
    defaultTradingSchedule();

  const confidenceColor =
    confidence >= 75
      ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
      : confidence >= 50
        ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
        : "border-destructive/40 text-destructive bg-destructive/10";

  return (
    <div className="space-y-4">
      {/* Plain-English confirm — primary for beginners */}
      <div className="rounded-md border border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-primary mb-1">Confirm</p>
            <h3 className="font-semibold text-sm leading-snug">{plain.headline}</h3>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${confidenceColor}`}
          >
            {confidence}% sure
          </span>
        </div>
        {blueprint.summary && (
          <p className="text-xs text-muted-foreground">{blueprint.summary}</p>
        )}
        <ol className="space-y-1.5 list-decimal list-inside">
          {plain.steps.map((step) => (
            <li key={step} className="text-sm text-foreground/90">
              {step}
            </li>
          ))}
        </ol>
        <p className="text-xs text-muted-foreground">{plain.riskLine}</p>
        {plain.scheduleLine && (
          <p className="text-xs text-muted-foreground">{plain.scheduleLine}</p>
        )}
      </div>

      {/* Compact meta — details stay available but not primary */}
      <div className="rounded-md border border-border bg-card p-4 space-y-3">
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Details</p>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded border border-border bg-muted/20 p-2">
            <p className="text-xl font-bold">
              {isFourBrain && blueprint.fourBrain
                ? (blueprint.fourBrain.direction ? 1 : 0) + (blueprint.fourBrain.setup ? 1 : 0) + 1
                : totalRules}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {isFourBrain ? "Layers" : "Rules"}
            </p>
          </div>
          <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2">
            <p className="text-xl font-bold text-emerald-400">
              {isFourBrain ? "OK" : compilableCount}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Ready</p>
          </div>
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2">
            <p className="text-xl font-bold text-amber-400">{subjectiveCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Need work</p>
          </div>
        </div>
        {blueprint.strategyType?.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {blueprint.strategyType.map((t) => (
              <span
                key={t}
                className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border"
              >
                {t.replace(/_/g, " ")}
              </span>
            ))}
          </div>
        )}
        {tradeChain.length > 0 && (
          <div className="rounded border border-border/60 bg-background/40 p-3 space-y-1">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Trade order
            </p>
            {tradeChain.map((step) => (
              <p key={step.id} className="text-[11px] text-muted-foreground">
                {step.order}. {step.name}
                {step.isEntry ? " → enter" : ""}
              </p>
            ))}
          </div>
        )}
        <details className="rounded border border-border/60 bg-muted/10 p-2">
          <summary className="text-[11px] text-muted-foreground cursor-pointer select-none">
            Technical mapping (optional)
          </summary>
          <div className="mt-2 space-y-2">
            {blueprint.fourBrain && (
              <p className="text-[11px] font-mono text-muted-foreground">
                {formatBrainChain(blueprint.fourBrain)}
              </p>
            )}
            {flow?.steps?.length
              ? flow.steps.map((step, i) =>
                  step.enabled === false ? null : (
                    <p key={step.id} className="text-[11px] font-mono text-muted-foreground">
                      {i + 1}. {step.name || step.id} · {step.module} @ {step.timeframe}
                    </p>
                  ),
                )
              : null}
            <BlueprintExplanationPanel blueprint={blueprint} />
          </div>
        </details>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Symbol</p>
            <p className="font-mono font-medium">{blueprint.execution?.symbol ?? "ANY"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Timeframe</p>
            <p className="font-mono font-medium">{blueprint.execution?.setupTimeframe ?? "-"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Risk</p>
            <p className="font-mono font-medium">{blueprint.risk?.riskPercent ?? 1}%</p>
          </div>
        </div>
      </div>

      {/* Rules card */}
      {blueprint.rules?.length > 0 && (
        <div className="rounded-md border border-border bg-card p-4 space-y-2">
          <p className="text-xs font-medium">What the AI understood</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
            {blueprint.rules.map((rule) => (
              <div key={rule.id} className="flex items-start gap-2 text-xs">
                {rule.compilable ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <HelpCircle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                )}
                <span className={rule.compilable ? "text-foreground" : "text-amber-300/90"}>
                  {rule.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Build status */}
      <BuildStatusCard blueprint={blueprint} />

      {blueprint.fourBrain && (
        <div className="space-y-3">
          <WhenToTradeCard value={tradingSchedule} onChange={onTradingScheduleChange} />
          <GenerationPathBanner blueprint={blueprint} />
          <TradeAuditPanel blueprint={blueprint} compact />
        </div>
      )}

      {/* Clarifications */}
      {clarifications.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-amber-400">
              Optional clarifications ({clarifications.length})
            </p>
            <p className="text-[11px] text-amber-300/70 mt-0.5">
              Answer any you want, or <strong>skip straight to Build</strong> — we’ll use sensible
              defaults.
            </p>
          </div>
          <div className="space-y-3">
            {clarifications.map((q, i) => (
              <div key={i} className="space-y-1">
                <p className="text-xs text-amber-300/90 leading-relaxed">• {q}</p>
                <Input
                  value={clarificationAnswers[i] ?? ""}
                  onChange={(e) => onAnswerChange(i, e.target.value)}
                  placeholder="Your answer…"
                  className="text-xs h-8 bg-background/50 border-amber-500/30 placeholder:text-muted-foreground/50"
                  disabled={busy}
                />
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefine}
            disabled={busy || Object.values(clarificationAnswers).every((v) => !v?.trim())}
            className="w-full border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
          >
            {busy && stageLabel?.includes("Refin") ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Refining…
              </>
            ) : (
              <>
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Refine Interview with Answers
              </>
            )}
          </Button>
        </div>
      )}

      {/* Save button */}
      {generationError && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
          <p className="font-medium">Cannot generate EA yet</p>
          <p className="mt-1 opacity-90">{generationError}</p>
          <p className="mt-2 text-muted-foreground">
            Refine your description, answer clarifications, or{" "}
            <Link to="/build" className="underline">
              customize visually
            </Link>
            .
          </p>
        </div>
      )}
      <Button
        onClick={onCreateDraft}
        disabled={busy || Boolean(generationError)}
        className="w-full"
        size="lg"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            {stageLabel ?? "Building…"}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-1.5" />
            Build my robot
          </>
        )}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        For research only. Always test on a demo account before live trading.
      </p>
    </div>
  );
}

// ─── Build Status Card ────────────────────────────────────────────────────────

function BuildStatusCard({ blueprint }: { blueprint: StrategyBlueprint }) {
  const generationError = firstBlueprintGenerationError(blueprint);

  if (blueprint.fourBrain) {
    if (generationError) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-destructive">
              Interview mapped 4-Brain - generation blocked
            </p>
            <span className="text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 border-destructive/40 text-destructive bg-destructive/10">
              blocked
            </span>
          </div>
          <p className="text-[11px] text-destructive/90">{generationError}</p>
          <p className="text-xs font-mono text-primary/80">
            {formatBrainChain(blueprint.fourBrain)}
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium">4-Brain ready - verified module path</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Review the compiler path and expected trade chain below, then Save to generate the EA
              from verified building blocks.
            </p>
          </div>
          <span className="text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
            ready
          </span>
        </div>
        <p className="text-xs font-mono text-primary/80">{formatBrainChain(blueprint.fourBrain)}</p>
      </div>
    );
  }

  const result: BuildabilityResult = analyzeBuildability(blueprint);

  const pillColor =
    result.coverage === 100
      ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
      : result.coverage >= 60
        ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
        : "border-destructive/40 text-destructive bg-destructive/10";

  const categoryBadge = (cat: "trigger" | "filter" | "state_machine" | "unsupported") => {
    if (cat === "trigger")
      return (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 font-medium uppercase tracking-wide">
          trigger
        </span>
      );
    if (cat === "filter")
      return (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-400 font-medium uppercase tracking-wide">
          filter
        </span>
      );
    if (cat === "state_machine")
      return (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-300 font-medium uppercase tracking-wide">
          state machine
        </span>
      );
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded bg-destructive/15 text-destructive font-medium uppercase tracking-wide">
        no primitive
      </span>
    );
  };

  return (
    <div
      className={`rounded-md border p-4 space-y-3 ${
        result.buildable && result.unsupportedCount === 0
          ? "border-emerald-500/30 bg-emerald-500/5"
          : result.buildable
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-destructive/30 bg-destructive/5"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">
            {result.buildable && result.unsupportedCount === 0
              ? "Template ready - all rules have implementations"
              : result.buildable
                ? "Partially buildable - some rules will be skipped"
                : "Not buildable yet - no entry trigger has an implementation"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {result.unsupportedCount === 0
              ? "Click Save to generate a compilable EA from verified blocks."
              : `${result.unsupportedCount} rule${result.unsupportedCount > 1 ? "s" : ""} don't map to a primitive - they'll be skipped.`}
          </p>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${pillColor}`}
        >
          {result.coverage}% covered
        </span>
      </div>
      <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
        {result.statuses.map(({ rule, category }) => (
          <div key={rule.id} className="flex items-start gap-2 text-xs">
            {category === "unsupported" ? (
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
            ) : (
              <CheckCircle2
                className={`h-3.5 w-3.5 shrink-0 mt-0.5 ${
                  category === "trigger"
                    ? "text-emerald-400"
                    : category === "state_machine"
                      ? "text-orange-300"
                      : "text-sky-400"
                }`}
              />
            )}
            <span
              className={
                category === "unsupported"
                  ? "text-destructive/80"
                  : category === "state_machine"
                    ? "text-muted-foreground"
                    : "text-foreground"
              }
            >
              {rule.label}
            </span>
            <span className="ml-auto shrink-0">{categoryBadge(category)}</span>
          </div>
        ))}
      </div>
      {result.unsupportedCount > 0 && (
        <div className="rounded bg-background/60 border border-border p-2.5 text-[11px] text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">How to fix unsupported rules:</p>
          <p>
            1. Click <strong>Edit prompt</strong> and rewrite vague rules as objectively measurable
            conditions.
          </p>
          <p>
            2. Re-run <strong>Interview Strategy</strong> - the AI will reclassify into a supported
            type.
          </p>
          <p>3. Or accept the skip: the EA will be generated without those rules.</p>
        </div>
      )}
    </div>
  );
}
