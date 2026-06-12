import { Plus, X } from "lucide-react";
import { Label } from "@/components/ui/label";
import { emaParamsForBlueprint, normalizeEmaParams, sanitizeEmaPeriods } from "@/lib/ema-params";

export function EmaPeriodEditor({
  params,
  onChange,
}: {
  params: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const normalized = normalizeEmaParams(params);
  const periods = normalized.periods.length ? normalized.periods : [21, 50];

  function setPeriods(next: number[]) {
    onChange(emaParamsForBlueprint({ ...params, emaPeriods: sanitizeEmaPeriods(next) }));
  }

  function updateAt(index: number, value: number) {
    if (!Number.isFinite(value) || value < 2) return;
    const next = [...periods];
    next[index] = value;
    setPeriods(next);
  }

  function removeAt(index: number) {
    if (periods.length <= 1) return;
    setPeriods(periods.filter((_, i) => i !== index));
  }

  function addPeriod() {
    if (periods.length >= 6) return;
    const last = periods[periods.length - 1] ?? 50;
    setPeriods([...periods, Math.min(500, last + 20)]);
  }

  const modeLabel =
    normalized.mode === "single"
      ? "Single EMA — bias from price vs line; retest that EMA"
      : normalized.mode === "dual"
        ? "Dual EMA — cross, retest slower line, confirm beyond faster"
        : "Multi EMA stack — all lines must align; cross uses shortest vs longest";

  return (
    <div className="col-span-2 space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-[11px] text-muted-foreground uppercase tracking-wide">
          EMA periods
        </Label>
        <button
          type="button"
          onClick={addPeriod}
          disabled={periods.length >= 6}
          className="inline-flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 disabled:opacity-40"
        >
          <Plus className="h-3 w-3" /> Add EMA
        </button>
      </div>
      <p className="text-[10px] text-muted-foreground leading-snug">{modeLabel}</p>
      <div className="flex flex-wrap gap-2">
        {periods.map((period, index) => (
          <div key={`${index}-${period}`} className="flex items-center gap-1">
            <input
              type="number"
              min={2}
              max={500}
              step={1}
              value={period}
              onChange={(e) => updateAt(index, parseFloat(e.target.value))}
              className="w-20 h-7 rounded border border-border bg-background px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              title={`EMA period ${index + 1}`}
            />
            {periods.length > 1 && (
              <button
                type="button"
                onClick={() => removeAt(index)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove EMA ${period}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
