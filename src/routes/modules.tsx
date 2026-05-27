import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Download, CheckCircle2, Clock, FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { generateFvgDetector } from "@/lib/smc-modules/fvg-detector";
import { generateFvgInversionDetector } from "@/lib/smc-modules/fvg-inversion-detector";

export const Route = createFileRoute("/modules")({
  component: ModulesPage,
});

/** Trigger a browser download of a plain-text file. */
function downloadMql5(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Module registry ──────────────────────────────────────────────────────────
// Each entry describes one Phase 1 detection module.
// status: "ready" | "pending"

interface ModuleEntry {
  id: string;
  filename: string;
  name: string;
  description: string;
  rules: string[];
  output: string[];
  status: "ready" | "pending";
  generate?: () => string;
}

const PHASE1_MODULES: ModuleEntry[] = [
  {
    id: "fvg",
    filename: "FVG_Detector.mq5",
    name: "FVG Detector",
    description: "Detects 3-candle Fair Value Gaps with full lifecycle management. Zones move through ACTIVE → MITIGATED → INVALIDATED / EXPIRED with configurable mitigation and invalidation modes.",
    rules: [
      "Bullish: C3.Low > C1.High  →  UL = C3.Low, LL = C1.High",
      "Bearish: C3.High < C1.Low  →  UL = C1.Low, LL = C3.High",
      "Mitigation: touch_edge (Low≤UL / High≥LL)  or  touch_midpoint",
      "Invalidation: candle_close (Close<LL / Close>UL)  or  wick_break",
      "Expiry: zone removed after InpExpiryBars bars (default 50)",
    ],
    output: [
      "ACTIVE → full opacity (InpActiveOpacity, default 70%)",
      "MITIGATED → faded opacity (InpMitigatedOpacity, default 25%)",
      "INVALIDATED / EXPIRED → removed or frozen dotted relic",
      "Journal: FVG_CREATED | FVG_MITIGATED | FVG_INVALIDATED | FVG_EXPIRED",
      "Inputs: mitigation_mode · invalidation_mode · expiry_bars · show_mitigated · remove_invalidated",
    ],
    status: "ready",
    generate: generateFvgDetector,
  },
  {
    id: "fvg-inversion",
    filename: "FVG_Inversion_Detector.mq5",
    name: "FVG Inversion Detector",
    description: "Detects FVG polarity flips. When price closes through an FVG, the zone becomes an Inversion FVG of opposite direction — a former support becomes resistance and vice versa.",
    rules: [
      "Bullish FVG → BEARISH inversion when: Close < LL",
      "Bearish FVG → BULLISH inversion when: Close > UL",
      "Inversion zone uses same UL/LL as original FVG",
      "Original zone frozen at inversion bar (dotted relic)",
      "Inversion zone itself can be invalidated (Close back through)",
    ],
    output: [
      "Original FVG: solid fill → dotted relic on inversion",
      "Inversion zone: dashed fill, distinct colour (green/orchid)",
      "Journal: FVG_INVERSION_CREATED | orig_id | new_dir | UL | LL | bar",
      "Journal: INV_INVALIDATED | inv_id | orig_id | dir | UL | LL | bar",
      "States: ACTIVE_FVG · MITIGATED · INVERTED · INVALIDATED (expired)",
    ],
    status: "ready",
    generate: generateFvgInversionDetector,
  },
  {
    id: "order-block",
    filename: "OB_Detector.mq5",
    name: "Order Block Detector",
    description: "Identifies the last opposing candle before a significant displacement move.",
    rules: [
      "Bullish OB: last bearish candle before a bullish displacement",
      "Bearish OB: last bullish candle before a bearish displacement",
      "Displacement = move that creates a FVG or BOS",
    ],
    output: [
      "Rectangle spanning the OB candle body",
      "Journal: OB_CREATED | id | dir | ob_time | body_high | body_low",
    ],
    status: "pending",
  },
  {
    id: "breaker-block",
    filename: "BB_Detector.mq5",
    name: "Breaker Block Detector",
    description: "An order block that failed — price swept through it and reversed, flipping its polarity.",
    rules: [
      "Bullish OB becomes bearish breaker when price closes below its low",
      "Bearish OB becomes bullish breaker when price closes above its high",
    ],
    output: [
      "Dashed rectangle with flipped colour",
      "Journal: BB_CREATED | id | origin_ob_id | flip_bar | dir",
    ],
    status: "pending",
  },
  {
    id: "liquidity-sweep",
    filename: "LiqSweep_Detector.mq5",
    name: "Liquidity Sweep Detector",
    description: "Detects candles that pierce a recent swing high/low and close back inside.",
    rules: [
      "Bullish sweep: wick below recent swing low, close above it",
      "Bearish sweep: wick above recent swing high, close below it",
    ],
    output: [
      "Arrow at the sweep wick tip",
      "Journal: LIQ_SWEEP | id | dir | sweep_bar | level | close",
    ],
    status: "pending",
  },
  {
    id: "bos-choch",
    filename: "BOS_CHoCH_Detector.mq5",
    name: "BOS / CHoCH Detector",
    description: "Identifies Break of Structure (trend continuation) and Change of Character (potential reversal).",
    rules: [
      "BOS: close beyond the most recent confirmed swing in the direction of the trend",
      "CHoCH: close beyond the most recent confirmed swing against the trend",
    ],
    output: [
      "Horizontal line at broken level",
      "Journal: BOS | CHoCH | id | dir | break_bar | level",
    ],
    status: "pending",
  },
  {
    id: "supply-demand",
    filename: "SD_Zone_Detector.mq5",
    name: "Supply & Demand Zone Detector",
    description: "Marks institutional supply and demand zones based on base-and-move patterns.",
    rules: [
      "Demand zone: consolidation (base) followed by a bullish move (DBR/RBR pattern)",
      "Supply zone: consolidation (base) followed by a bearish move (DBD/RBD pattern)",
      "Base = 1–4 small-range candles before the displacement",
    ],
    output: [
      "Rectangle spanning the base candles",
      "Journal: SD_CREATED | id | type | base_start | base_end | top | bottom",
    ],
    status: "pending",
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

function ModuleCard({ mod }: { mod: ModuleEntry }) {
  const isReady = mod.status === "ready";

  const handleDownload = () => {
    if (!mod.generate) return;
    try {
      const code = mod.generate();
      downloadMql5(mod.filename, code);
      toast.success(`${mod.filename} downloaded — open in MetaEditor and compile`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  return (
    <div
      className={`rounded-lg border bg-card p-5 flex flex-col gap-4 transition-opacity ${
        isReady ? "border-border" : "border-border/40 opacity-60"
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold text-sm">{mod.name}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
              Phase 1
            </span>
            {isReady ? (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="h-2.5 w-2.5" /> Ready
              </span>
            ) : (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border flex items-center gap-1">
                <Clock className="h-2.5 w-2.5" /> Coming soon
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{mod.description}</p>
        </div>

        {isReady && (
          <Button size="sm" onClick={handleDownload} className="shrink-0">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Download .mq5
          </Button>
        )}
      </div>

      {/* Detection rules */}
      <div className="grid sm:grid-cols-2 gap-4 text-xs">
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            Detection rules
          </p>
          <ul className="space-y-1">
            {mod.rules.map((r, i) => (
              <li key={i} className="text-muted-foreground flex gap-1.5">
                <span className="text-primary/60 shrink-0">→</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
            Output
          </p>
          <ul className="space-y-1">
            {mod.output.map((o, i) => (
              <li key={i} className="text-muted-foreground flex gap-1.5">
                <span className="text-primary/60 shrink-0">→</span>
                <span>{o}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Filename */}
      <div className="text-[10px] text-muted-foreground/60 font-mono border-t border-border/40 pt-2">
        {mod.filename}
      </div>
    </div>
  );
}

function ModulesPage() {
  return (
    <div>
      <PageHeader
        title="SMC Module Library"
        subtitle="Phase 1 — Detection only. No trades, no execution. Verify each concept independently before building EAs."
      />

      <div className="p-6 space-y-6 max-w-4xl">

        {/* Phase banner */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3">
          <FlaskConical className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-primary/80 space-y-0.5">
            <p className="font-semibold text-primary">Phase 1: Detection modules</p>
            <p>
              Each module is a standalone MQL5 indicator. Download, compile in MetaEditor,
              attach to a chart, and visually verify that zones are drawn correctly before
              any execution logic is added.
            </p>
            <p className="mt-1">
              <span className="font-medium">Verification checklist:</span>{" "}
              correct zone boundaries · journal logs present · no phantom zones ·
              historical scan matches live detection
            </p>
          </div>
        </div>

        {/* Module cards */}
        <div className="space-y-3">
          {PHASE1_MODULES.map((mod) => (
            <ModuleCard key={mod.id} mod={mod} />
          ))}
        </div>

        {/* Road map footer */}
        <div className="text-xs text-muted-foreground border-t border-border pt-4 space-y-1">
          <p className="font-medium text-foreground/60">Road map</p>
          <p>Phase 2 — State modules: retest, mitigation, invalidation, expiry</p>
          <p>Phase 3 — Execution modules: entry timing, SL, TP, break-even, trailing</p>
        </div>
      </div>
    </div>
  );
}
