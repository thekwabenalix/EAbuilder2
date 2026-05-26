import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Sparkles,
  Loader2,
  Wand2,
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  Edit2,
} from "lucide-react";
import { EXAMPLE_PROMPT } from "@/types/strategy";
import type { StrategyBlueprint } from "@/types/blueprint";
import { parseStrategy, generateCode } from "@/lib/api-client";
import { createStrategy } from "@/lib/strategies";
import { toast } from "sonner";

export const Route = createFileRoute("/new")({
  component: NewStrategy,
});

type Stage = "idle" | "interviewing" | "reviewed" | "generating";

function NewStrategy() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<StrategyBlueprint | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to interview strategy. Please try again.");
      setStage("idle");
    } finally {
      setStageLabel(null);
    }
  };

  const onCreateDraft = async () => {
    if (!blueprint || !user) return;
    setError(null);
    setStage("generating");
    setStageLabel("Generating MQL5 code…");

    try {
      const { code: generatedCode } = await generateCode(blueprint);

      setStageLabel("Saving to library…");
      const row = await createStrategy({
        userId: user.id,
        name: blueprint.name || "Untitled Strategy",
        prompt,
        blueprint,
        generatedCode,
      });

      toast.success("Strategy draft created");
      navigate({ to: "/s/$id", params: { id: row.id } });
    } catch (e: unknown) {
      console.error(e);
      setError(e instanceof Error ? e.message : "Failed to generate code. Please try again.");
      setStage("reviewed");
    } finally {
      setStageLabel(null);
    }
  };

  const onEditPrompt = () => {
    setStage("idle");
    setBlueprint(null);
    setError(null);
  };

  return (
    <div>
      <PageHeader
        title="New Strategy"
        subtitle={
          stage === "reviewed"
            ? "Review what the AI understood, then create the draft."
            : "Describe any forex strategy in plain English. The AI interviews it first."
        }
      />

      <div
        className={`p-6 ${stage === "reviewed" ? "grid grid-cols-2 gap-6 items-start" : "max-w-3xl space-y-4"}`}
      >
        {/* ── LEFT: Prompt panel ── */}
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
                rows={14}
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
                The AI will analyse and show you what it understood before generating code.
              </p>
            </div>
          )}

          {stage !== "reviewed" && (
            <div className="rounded-md border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Understands any strategy including:</p>
              <p>
                Price action · ICT / SMC (order blocks, FVGs, liquidity sweeps, BOS/CHOCH) · Supply
                & Demand · Indicators (EMA, RSI, MACD, Bollinger, ATR…) · Wyckoff · Breakout ·
                Session · Multi-timeframe · Scalping · Grid · News trading · And more
              </p>
            </div>
          )}
        </div>

        {/* ── RIGHT: Interview result panel ── */}
        {stage === "reviewed" && blueprint && (
          <InterviewPanel
            blueprint={blueprint}
            onCreateDraft={onCreateDraft}
            busy={busy}
            stageLabel={stageLabel}
          />
        )}
      </div>
    </div>
  );
}

function InterviewPanel({
  blueprint,
  onCreateDraft,
  busy,
  stageLabel,
}: {
  blueprint: StrategyBlueprint;
  onCreateDraft: () => void;
  busy: boolean;
  stageLabel: string | null;
}) {
  const compilableCount = blueprint.compilableRuleIds?.length ?? 0;
  const subjectiveCount = blueprint.subjectiveRuleIds?.length ?? 0;
  const totalRules = blueprint.rules?.length ?? 0;
  const clarifications = blueprint.pendingClarifications ?? [];
  const confidence = blueprint.confidence ?? 0;

  const confidenceColor =
    confidence >= 75
      ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
      : confidence >= 50
        ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
        : "border-destructive/40 text-destructive bg-destructive/10";

  return (
    <div className="space-y-4">
      {/* ── Header card ── */}
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

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded border border-border bg-muted/20 p-2">
            <p className="text-xl font-bold">{totalRules}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Rules</p>
          </div>
          <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2">
            <p className="text-xl font-bold text-emerald-400">{compilableCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Compilable</p>
          </div>
          <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2">
            <p className="text-xl font-bold text-amber-400">{subjectiveCount}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Need work</p>
          </div>
        </div>

        {/* Strategy type tags */}
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

        {/* Execution summary */}
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

      {/* ── Rules card ── */}
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

      {/* ── Clarifications card ── */}
      {clarifications.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
          <p className="text-xs font-medium text-amber-400">
            Questions to clarify ({clarifications.length})
          </p>
          <ul className="space-y-1">
            {clarifications.map((q, i) => (
              <li key={i} className="text-xs text-amber-300/90">
                • {q}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Create Draft button ── */}
      <Button onClick={onCreateDraft} disabled={busy} className="w-full" size="lg">
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            {stageLabel ?? "Generating…"}
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-1.5" />
            Create Strategy Draft
          </>
        )}
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        Generated EAs are provided for research only. Always test on a demo account.
      </p>
    </div>
  );
}
