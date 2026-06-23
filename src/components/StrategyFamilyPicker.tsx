import type { ElementType } from "react";
import type { StrategyFamily } from "@/lib/strategy-family";
import { STRATEGY_FAMILIES, familyMeta } from "@/lib/strategy-family";
import { BarChart3, GitMerge, Layers, TrendingUp } from "lucide-react";

const FAMILY_ICONS: Record<StrategyFamily, ElementType> = {
  smc_ict: Layers,
  snr_snd: BarChart3,
  indicators: TrendingUp,
  hybrid: GitMerge,
};

export function StrategyFamilyPicker({
  value,
  onChange,
  compact = false,
}: {
  value: StrategyFamily | null;
  onChange: (family: StrategyFamily) => void;
  compact?: boolean;
}) {
  return (
    <div className="space-y-2">
      {!compact && (
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
            Step 0 — Strategy family
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-2xl">
            Pick the trading school first. Module pickers show only modules that fit — SNR Rejection
            is separate from SMC zone touch/confirm on OB, FVG, or Unicorn pockets.
          </p>
        </div>
      )}
      <div
        className={[
          "grid gap-2",
          compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        ].join(" ")}
      >
        {STRATEGY_FAMILIES.map((family) => {
          const Icon = FAMILY_ICONS[family.id];
          const active = value === family.id;
          return (
            <button
              key={family.id}
              type="button"
              onClick={() => onChange(family.id)}
              className={[
                "flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-all",
                active
                  ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                  : "border-border bg-card/60 hover:border-primary/40 hover:bg-muted/20",
              ].join(" ")}
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={[
                    "h-4 w-4 shrink-0",
                    active ? "text-primary" : "text-muted-foreground",
                  ].join(" ")}
                />
                <span className="text-sm font-semibold">{family.label}</span>
              </div>
              {!compact && (
                <>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {family.description}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70 font-mono">
                    {family.examples}
                  </p>
                </>
              )}
            </button>
          );
        })}
      </div>
      {value && !compact && (
        <p className="text-[10px] text-muted-foreground">
          Selected: <span className="text-foreground font-medium">{familyMeta(value).label}</span>
          {value === "hybrid" && " — cross-family mixes show warnings at generate time."}
        </p>
      )}
    </div>
  );
}
