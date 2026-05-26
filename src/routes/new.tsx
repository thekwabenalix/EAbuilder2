import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Sparkles, Loader2, Wand2, AlertTriangle } from "lucide-react";
import { EXAMPLE_PROMPT } from "@/types/strategy";
import { parseStrategy } from "@/lib/api-client";
import { createStrategy } from "@/lib/strategies";
import { toast } from "sonner";

export const Route = createFileRoute("/new")({
  component: NewStrategy,
});

function NewStrategy() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onExtract = async () => {
    setError(null);
    if (prompt.trim().length < 20) {
      setError("Please describe your strategy in more detail (at least 20 characters).");
      return;
    }
    if (!user) return;

    setBusy(true);
    setStage("Understanding strategy…");

    try {
      setStage("Extracting rules & blueprint…");
      const result = await parseStrategy(prompt);

      setStage("Saving to library…");
      const row = await createStrategy({
        userId: user.id,
        name: result.blueprint.name || "Untitled Strategy",
        prompt,
        blueprint: result.blueprint,
        generatedCode: result.generatedCode,
      });

      toast.success("Strategy built with AI");
      navigate({ to: "/s/$id", params: { id: row.id } });
    } catch (e: unknown) {
      console.error(e);
      setError(
        e instanceof Error
          ? e.message
          : "Failed to parse strategy — check that ANTHROPIC_API_KEY is set in Netlify.",
      );
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="New Strategy"
        subtitle="Describe any forex strategy in plain English. The AI builds the EA — no coding needed."
      />
      <div className="p-6 max-w-3xl space-y-4">
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
              "• Use the 50 and 200 EMA cross on H4 for trend direction, enter on M5 pullback to 50 EMA\n" +
              "• Buy when price sweeps Asia range low and closes back inside with a bullish engulfing"
            }
            className="font-mono text-sm"
          />
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={onExtract} disabled={busy} className="min-w-[180px]">
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                {stage ?? "Building…"}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-1.5" />
                Build EA with AI
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            Generated EAs are provided for research only. Always test on a demo account.
          </p>
        </div>

        <div className="rounded-md border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">The AI understands any strategy including:</p>
          <p>
            Price action · ICT / SMC (order blocks, FVGs, liquidity sweeps, BOS/CHOCH) · Supply &
            Demand · Support & Resistance · Indicators (EMA, RSI, MACD, Bollinger, ATR…) · Wyckoff ·
            Breakout systems · Session strategies · Multi-timeframe · Scalping · Grid / martingale ·
            News trading · And more
          </p>
        </div>
      </div>
    </div>
  );
}
