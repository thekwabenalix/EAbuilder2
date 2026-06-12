import { useMemo, useState } from "react";
import type { BrainModuleType } from "@/types/blueprint";
import type { BuiltinFilterRef } from "@/lib/builtin-filter-contracts";
import {
  createCatalogRefFromPicker,
  createFilterRefFromPicker,
  defaultAppliesToForBrain,
  INDICATOR_PICKER_CATEGORIES,
  INDICATOR_PICKER_OPTIONS,
  type IndicatorPickerCategory,
  type IndicatorPickerOption,
  type IndicatorWiringKind,
} from "@/lib/builtin-indicator-ui";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Activity, ChevronLeft, Gauge, LineChart, Waves } from "lucide-react";

const CATEGORY_ICON: Record<IndicatorPickerCategory, typeof LineChart> = {
  trend: LineChart,
  oscillator: Activity,
  volume: Waves,
  bill_williams: Gauge,
};

const WIRING_TONE: Record<IndicatorWiringKind, string> = {
  filter: "text-sky-300 border-sky-500/30 bg-sky-500/10",
  brain_module: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  catalog: "text-muted-foreground border-border bg-muted/30",
};

export interface IndicatorPickerResult {
  kind: IndicatorWiringKind;
  message: string;
  brainModule?: BrainModuleType;
  filterRef?: BuiltinFilterRef;
  indicatorRef?: import("@/lib/indicator-boundary").BuiltinIndicatorRef;
  catalogNote?: string;
}

export function BuiltinIndicatorPicker({
  open,
  onOpenChange,
  timeframe,
  brainRole,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timeframe: string;
  brainRole: "direction" | "setup" | "execution";
  onApply: (result: IndicatorPickerResult) => void;
}) {
  const [category, setCategory] = useState<IndicatorPickerCategory | null>(null);
  const [selected, setSelected] = useState<IndicatorPickerOption | null>(null);
  const [appliesTo, setAppliesTo] = useState<"setup" | "execution">(
    defaultAppliesToForBrain(brainRole),
  );

  const options = useMemo(
    () => (category ? INDICATOR_PICKER_OPTIONS.filter((o) => o.category === category) : []),
    [category],
  );

  function reset() {
    setCategory(null);
    setSelected(null);
    setAppliesTo(defaultAppliesToForBrain(brainRole));
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  function confirm() {
    if (!selected) return;
    if (selected.wiring === "brain_module" && selected.brainModule) {
      onApply({
        kind: "brain_module",
        brainModule: selected.brainModule,
        message: `${selected.name} added as a brain module — regenerate EA to compile.`,
      });
      close();
      return;
    }
    if (selected.wiring === "filter" && selected.filterContractId) {
      const filterRef = createFilterRefFromPicker(selected, timeframe, appliesTo);
      if (filterRef) {
        onApply({
          kind: "filter",
          filterRef,
          message: `${selected.name} filter added — gates ${appliesTo} on ${timeframe}.`,
        });
        close();
      }
      return;
    }
    if (selected.wiring === "catalog") {
      const catalog = createCatalogRefFromPicker(selected);
      onApply({
        kind: "catalog",
        indicatorRef: catalog ?? undefined,
        catalogNote: catalog?.name ?? selected.name,
        message: `${selected.name} saved as reference — not compiled yet. Use RSI/MACD/EMA wired options for live EAs.`,
      });
      close();
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Built-in indicator</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Pick trend or oscillator — the builder wires verified filters or modules into your EA.
            No need to describe MACD/RSI in notes unless you want custom thresholds.
          </DialogDescription>
        </DialogHeader>

        {!category && (
          <div className="grid grid-cols-2 gap-2">
            {INDICATOR_PICKER_CATEGORIES.map((cat) => {
              const Icon = CATEGORY_ICON[cat.id];
              const count = INDICATOR_PICKER_OPTIONS.filter((o) => o.category === cat.id).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategory(cat.id)}
                  className="rounded-lg border border-border bg-card/50 p-3 text-left hover:border-primary/40 hover:bg-primary/5 transition-colors"
                >
                  <Icon className="h-4 w-4 text-primary mb-1.5" />
                  <p className="text-sm font-medium">{cat.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-snug">
                    {cat.hint}
                  </p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">{count} option(s)</p>
                </button>
              );
            })}
          </div>
        )}

        {category && !selected && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setCategory(null)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" /> Categories
            </button>
            <div className="max-h-64 overflow-y-auto space-y-1.5">
              {options.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setSelected(opt)}
                  className="w-full rounded-md border border-border px-3 py-2 text-left hover:border-primary/40 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium flex-1">{opt.name}</span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded border font-medium ${WIRING_TONE[opt.wiring]}`}
                    >
                      {opt.wiringLabel}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 leading-snug">
                    {opt.description}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {selected && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-3 w-3" /> Back
            </button>
            <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1">
              <p className="text-sm font-medium">{selected.name}</p>
              <p className="text-[11px] text-muted-foreground">{selected.description}</p>
              <p className="text-[10px] text-muted-foreground">
                Timeframe: <span className="font-mono text-foreground">{timeframe}</span>
              </p>
            </div>

            {selected.wiring === "filter" && (
              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Gate which step?
                </Label>
                <div className="flex gap-2">
                  {(["setup", "execution"] as const).map((role) => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => setAppliesTo(role)}
                      className={[
                        "flex-1 rounded-md border px-2 py-1.5 text-xs capitalize transition-colors",
                        appliesTo === role
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/40",
                      ].join(" ")}
                    >
                      {role}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Filters never create trades alone — they only allow/block when your modules fire.
                </p>
              </div>
            )}

            {selected.wiring === "catalog" && (
              <p className="text-[11px] text-amber-300/90 rounded-md border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                This indicator is not compiled yet. It will appear on your blueprint for reference.
                Choose RSI, MACD, or EMA above for live wiring.
              </p>
            )}

            <Button type="button" className="w-full" onClick={confirm}>
              {selected.wiring === "catalog" ? "Save as reference" : "Add to strategy"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
