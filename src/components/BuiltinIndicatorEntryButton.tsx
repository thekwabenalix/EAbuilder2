import { LineChart } from "lucide-react";

export function BuiltinIndicatorEntryButton({
  onClick,
  compact,
}: {
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full flex items-center gap-2 rounded-lg border border-sky-500/50 bg-sky-500/10 text-left transition-colors hover:bg-sky-500/20 hover:border-sky-400/60",
        compact ? "px-2.5 py-2" : "px-3 py-2.5",
      ].join(" ")}
    >
      <LineChart className="h-4 w-4 text-sky-400 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="text-xs font-semibold text-sky-300 block">Built-in indicator</span>
        {!compact && (
          <span className="text-[10px] text-muted-foreground">
            Trend or oscillator — MACD, RSI, EMA, Bollinger
          </span>
        )}
      </span>
    </button>
  );
}
