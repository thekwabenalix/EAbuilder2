import { LineChart } from "lucide-react";

export function BuiltinIndicatorEntryButton({
  onClick,
  compact,
  emphasize,
}: {
  onClick: () => void;
  compact?: boolean;
  emphasize?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full flex items-center gap-2 rounded-lg border text-left transition-colors",
        emphasize
          ? "border-sky-400/70 bg-sky-500/15 hover:bg-sky-500/25 hover:border-sky-300"
          : "border-sky-500/50 bg-sky-500/10 hover:bg-sky-500/20 hover:border-sky-400/60",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
      ].join(" ")}
    >
      <LineChart className="h-4 w-4 text-sky-400 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="text-xs font-semibold text-sky-300 block">
          {emphasize ? "Browse MT5 built-in indicators" : "Built-in indicator"}
        </span>
        {!compact && (
          <span className="text-[10px] text-muted-foreground">
            Trend, oscillators, volume, Bill Williams — same list as MetaTrader Insert → Indicators
          </span>
        )}
      </span>
    </button>
  );
}
