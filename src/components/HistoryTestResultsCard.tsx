import type { StrategyBlueprint } from "@/types/blueprint";
import type { ReportSummary } from "@/types/mt5";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  buildPlainEnglishResults,
  type PlainEnglishResults,
} from "@/lib/plain-english-results";
import { AlertTriangle, Bot, CheckCircle2, Info, XCircle } from "lucide-react";

function toneClasses(tone: PlainEnglishResults["tone"]): string {
  if (tone === "success") return "border-emerald-500/35 bg-emerald-500/5";
  if (tone === "warning") return "border-amber-500/35 bg-amber-500/5";
  if (tone === "danger") return "border-destructive/35 bg-destructive/5";
  return "border-border bg-card/50";
}

function ToneIcon({ tone }: { tone: PlainEnglishResults["tone"] }) {
  if (tone === "success") return <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />;
  if (tone === "warning") return <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />;
  if (tone === "danger") return <XCircle className="h-5 w-5 text-destructive shrink-0" />;
  return <Info className="h-5 w-5 text-sky-400 shrink-0" />;
}

export function HistoryTestResultsCard({
  blueprint,
  success,
  summary,
  testerLog,
  symbol,
  period,
  fromDate,
  toDate,
  suggestedPeriod,
  onAskAssistant,
  onRetest,
}: {
  blueprint: StrategyBlueprint;
  success: boolean;
  summary: ReportSummary | null;
  testerLog?: string | null;
  symbol: string;
  period: string;
  fromDate: string;
  toDate: string;
  suggestedPeriod?: string;
  onAskAssistant?: (prompt: string) => void;
  onRetest?: () => void;
}) {
  const story = useMemo(
    () =>
      buildPlainEnglishResults({
        blueprint,
        success,
        summary,
        testerLog,
        symbol,
        period,
        fromDate,
        toDate,
        suggestedPeriod,
      }),
    [
      blueprint,
      success,
      summary,
      testerLog,
      symbol,
      period,
      fromDate,
      toDate,
      suggestedPeriod,
    ],
  );

  return (
    <div className={`rounded-lg border p-4 space-y-3 ${toneClasses(story.tone)}`}>
      <div className="flex items-start gap-3">
        <ToneIcon tone={story.tone} />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-semibold text-foreground">{story.headline}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{story.summary}</p>
        </div>
      </div>

      {story.likelyCause && (
        <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Most likely reason
          </p>
          <p className="text-xs text-foreground mt-0.5 leading-relaxed">{story.likelyCause}</p>
        </div>
      )}

      <ul className="space-y-1.5">
        {story.bullets.map((b) => (
          <li key={b} className="text-xs text-muted-foreground leading-relaxed pl-3 relative">
            <span className="absolute left-0 top-1.5 h-1 w-1 rounded-full bg-muted-foreground/50" />
            {b}
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 pt-1">
        {story.nextAction.kind === "ask_assistant" && onAskAssistant && (
          <Button
            size="sm"
            onClick={() => onAskAssistant(story.nextAction.kind === "ask_assistant" ? story.nextAction.prompt : "")}
          >
            <Bot className="h-3.5 w-3.5 mr-1.5" />
            {story.nextAction.label}
          </Button>
        )}
        {suggestedPeriod && suggestedPeriod !== period && onRetest && success && (
          <Button size="sm" variant="outline" onClick={onRetest}>
            Retest on {suggestedPeriod}
          </Button>
        )}
        {story.nextAction.kind === "retest" && onRetest && (
          <Button size="sm" variant="outline" onClick={onRetest}>
            {story.nextAction.label}
          </Button>
        )}
      </div>
    </div>
  );
}
