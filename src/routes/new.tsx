import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
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
  Brain,
  ArrowRight,
} from "lucide-react";
import { EXAMPLE_PROMPT } from "@/types/strategy";
import type { StrategyBlueprint } from "@/types/blueprint";
import { parseStrategy } from "@/lib/api-client";
import { createStrategy } from "@/lib/strategies";
import { toast } from "sonner";
import { analyzeBuildability } from "@/lib/mql5-template-generator";
import type { BuildabilityResult } from "@/lib/mql5-template-generator";
import { formatBrainChain } from "@/lib/brain-modules";
import { BlueprintExplanationPanel } from "@/components/BlueprintExplanationPanel";
import { firstBlueprintContractError } from "@/lib/blueprint-explanation";

export const Route = createFileRoute("/new")({
  component: StrategyBuilders,
});

type Stage = "idle" | "interviewing" | "reviewed" | "generating";

function StrategyBuilders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<StrategyBlueprint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<number, string>>({});

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
      setBlueprint(bp as StrategyBlueprint);
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
    const contractError = firstBlueprintContractError(blueprint);
    if (contractError) {
      setError(contractError);
      toast.error("Fix the strategy contract before saving.");
      return;
    }
    setError(null);
    setStage("generating");
    setStageLabel("Saving strategy…");
    try {
      const row = await createStrategy({
        userId: user.id,
        name: blueprint.name || "Untitled Strategy",
        prompt,
        blueprint,
        generatedCode: "",
      });
      toast.success("Strategy draft created — open the Code tab to generate MQL5");
      navigate({ to: "/s/$id", params: { id: row.id } });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save strategy. Please try again.");
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
      setBlueprint(bp as StrategyBlueprint);
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
        title="Strategy Builders"
        subtitle="Two ways to create an Expert Advisor — choose the one that fits your workflow"
      />

      <div className="p-6 space-y-8 max-w-5xl">
        {/* ── Builder selection cards (shown only on idle) ── */}
        {stage === "idle" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* 4-Brain Visual Builder */}
            <Link to="/build" className="group block">
              <div className="h-full rounded-xl border border-primary/30 bg-primary/5 p-6 space-y-3 hover:border-primary/60 hover:bg-primary/10 transition-all cursor-pointer">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center">
                    <Brain className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">4-Brain Visual Builder</h3>
                    <p className="text-[11px] text-muted-foreground">Multi-timeframe confluence</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Configure Direction, Setup, Execution and Management brains visually. Each brain
                  runs on its own timeframe — any module, any combination. Instant compilable MQL5
                  output.
                </p>
                <ul className="text-[11px] text-muted-foreground space-y-0.5">
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-primary" /> Visual brain config editor
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-primary" /> 14 modules — any brain, any TF
                  </li>
                  <li className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-3 w-3 text-primary" /> Guaranteed to compile, 0
                    errors
                  </li>
                </ul>
                <div className="flex items-center gap-1 text-xs text-primary font-medium pt-1">
                  Open 4-Brain Builder
                  <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                </div>
              </div>
            </Link>

            {/* AI Description Builder */}
            <div className="h-full rounded-xl border border-violet-500/20 bg-violet-500/5 p-6 space-y-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-violet-500/15 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-violet-400" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">AI Description Builder</h3>
                  <p className="text-[11px] text-muted-foreground">Plain-English to EA</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Describe any strategy in plain English. The AI interviews it, extracts all rules,
                and generates a compilable MQL5 Expert Advisor.
              </p>
              <ul className="text-[11px] text-muted-foreground space-y-0.5">
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-violet-400" /> Supports any indicator or
                  pattern
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-violet-400" /> AI interview clarifies
                  ambiguity
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3 text-violet-400" /> Rules reviewed before saving
                </li>
              </ul>
              <div className="flex items-center gap-1 text-xs text-violet-400 font-medium pt-1">
                Use the form below ↓
              </div>
            </div>
          </div>
        )}

        {/* ── Divider ── */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider px-2">
            {stage === "reviewed" ? "AI Interview Result" : "AI Description Builder"}
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* ── AI Builder form ── */}
        <div className={stage === "reviewed" ? "grid grid-cols-2 gap-6 items-start" : "space-y-4"}>
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
                      Interview Strategy
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  The AI will analyse and show what it understood before saving.
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
}: {
  blueprint: StrategyBlueprint;
  onCreateDraft: () => void;
  onRefine: () => void;
  busy: boolean;
  stageLabel: string | null;
  clarificationAnswers: Record<number, string>;
  onAnswerChange: (index: number, value: string) => void;
}) {
  const compilableCount = blueprint.compilableRuleIds?.length ?? 0;
  const subjectiveCount = blueprint.subjectiveRuleIds?.length ?? 0;
  const totalRules = blueprint.rules?.length ?? 0;
  const clarifications = blueprint.pendingClarifications ?? [];
  const confidence = blueprint.confidence ?? 0;
  const isFourBrain = Boolean(blueprint.fourBrain);

  const confidenceColor =
    confidence >= 75
      ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
      : confidence >= 50
        ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
        : "border-destructive/40 text-destructive bg-destructive/10";

  return (
    <div className="space-y-4">
      {/* Header card */}
      <div className="rounded-md border border-border bg-card p-4 space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
              Interview Result
            </p>
            <h3 className="font-semibold">{blueprint.name}</h3>
          </div>
          <span
            className={`text-xs px-2 py-0.5 rounded-full border font-medium ${confidenceColor}`}
          >
            {confidence}% confidence
          </span>
        </div>
        {blueprint.summary && <p className="text-xs text-muted-foreground">{blueprint.summary}</p>}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded border border-border bg-muted/20 p-2">
            <p className="text-xl font-bold">
              {isFourBrain && blueprint.fourBrain
                ? (blueprint.fourBrain.direction ? 1 : 0) + (blueprint.fourBrain.setup ? 1 : 0) + 1
                : totalRules}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
              {isFourBrain ? "Brains" : "Rules"}
            </p>
          </div>
          <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2">
            <p className="text-xl font-bold text-emerald-400">
              {isFourBrain ? "4B" : compilableCount}
            </p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Compilable</p>
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
        {blueprint.fourBrain && (
          <div className="rounded border border-primary/30 bg-primary/5 p-3">
            <p className="text-[10px] uppercase tracking-wide text-primary mb-1">4-Brain Mapping</p>
            <p className="text-xs font-mono text-primary/90">
              {formatBrainChain(blueprint.fourBrain)}
            </p>
          </div>
        )}
        <BlueprintExplanationPanel blueprint={blueprint} />
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Symbol</p>
            <p className="font-mono font-medium">{blueprint.execution?.symbol ?? "ANY"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-[10px] uppercase tracking-wide">Timeframe</p>
            <p className="font-mono font-medium">{blueprint.execution?.setupTimeframe ?? "—"}</p>
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

      {/* Clarifications */}
      {clarifications.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
          <div>
            <p className="text-xs font-medium text-amber-400">
              Optional clarifications ({clarifications.length})
            </p>
            <p className="text-[11px] text-amber-300/70 mt-0.5">
              Answer any you want, or <strong>skip straight to Save</strong> — the EA will use
              sensible defaults.
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
      <Button onClick={onCreateDraft} disabled={busy} className="w-full" size="lg">
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            {stageLabel ?? "Generating…"}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-1.5" />
            Save &amp; Open Strategy
          </>
        )}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        Generated EAs are provided for research only. Always test on a demo account.
      </p>
    </div>
  );
}

// ─── Build Status Card ────────────────────────────────────────────────────────

function BuildStatusCard({ blueprint }: { blueprint: StrategyBlueprint }) {
  if (blueprint.fourBrain) {
    return (
      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium">4-Brain ready — verified module path</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Click Save to open the Brains tab, review the mapping, then generate the EA from
              verified building blocks.
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
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 font-medium uppercase tracking-wide">
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
              ? "Template ready — all rules have implementations"
              : result.buildable
                ? "Partially buildable — some rules will be skipped"
                : "Not buildable yet — no entry trigger has an implementation"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {result.unsupportedCount === 0
              ? "Click Save to generate a compilable EA from verified blocks."
              : `${result.unsupportedCount} rule${result.unsupportedCount > 1 ? "s" : ""} don't map to a primitive — they'll be skipped.`}
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
                      ? "text-violet-400"
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
            2. Re-run <strong>Interview Strategy</strong> — the AI will reclassify into a supported
            type.
          </p>
          <p>3. Or accept the skip: the EA will be generated without those rules.</p>
        </div>
      )}
    </div>
  );
}
