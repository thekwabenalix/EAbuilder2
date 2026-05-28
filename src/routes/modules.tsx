import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Download,
  CheckCircle2,
  Clock,
  Rocket,
  FlaskConical,
  TrendingUp,
  Minus,
  ArrowUpDown,
  Activity,
  BarChart2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { generateFvgDetector } from "@/lib/smc-modules/fvg-detector";
import { generateFvgInversionDetector } from "@/lib/smc-modules/fvg-inversion-detector";
import { generateObDetector } from "@/lib/smc-modules/ob-detector";
import { generateBbDetector } from "@/lib/smc-modules/bb-detector";
import { generateLiqSweepDetector } from "@/lib/smc-modules/liqsweep-detector";
import { generateSwingStructureDetector } from "@/lib/smc-modules/swing-structure-detector";
import { generateBosDetector } from "@/lib/smc-modules/bos-detector";
import { generateChochDetector } from "@/lib/smc-modules/choch-detector";

export const Route = createFileRoute("/modules")({
  component: ModulesPage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Types ────────────────────────────────────────────────────────────────────

type ModuleStatus = "ready" | "pending" | "planned";

interface ModuleEntry {
  id: string;
  filename: string;
  name: string;
  description: string;
  rules?: string[];
  output?: string[];
  status: ModuleStatus;
  generate?: () => string;
}

interface ModuleCategory {
  id: string;
  label: string;        // short tab label
  fullName: string;     // expanded name
  icon: LucideIcon;
  phaseTag: string;     // e.g. "Phase 1 Active" | "Roadmap"
  phaseActive: boolean; // drives the tag colour
  description: string;
  modules: ModuleEntry[];
}

// ─── Module Registry ──────────────────────────────────────────────────────────

const TRADING_MODULES: ModuleCategory[] = [

  // ── 1. Smart Money Concepts ───────────────────────────────────────────────
  {
    id: "smc",
    label: "SMC",
    fullName: "Smart Money Concepts",
    icon: TrendingUp,
    phaseTag: "Phase 1 Active",
    phaseActive: true,
    description:
      "Institutional price-action concepts: FVGs, Order Blocks, Breaker Blocks, " +
      "Liquidity Sweeps, BOS/CHoCH, and more. Phase 1 = detection and visualisation " +
      "only — no execution logic.",
    modules: [
      {
        id: "fvg",
        filename: "FVG_Detector.mq5",
        name: "FVG Detector",
        description:
          "Detects 3-candle Fair Value Gaps with full lifecycle management. Zones " +
          "move through ACTIVE → MITIGATED → INVALIDATED / EXPIRED with configurable " +
          "mitigation and invalidation modes.",
        rules: [
          "Bullish: C3.Low > C1.High  →  UL = C3.Low, LL = C1.High",
          "Bearish: C3.High < C1.Low  →  UL = C1.Low, LL = C3.High",
          "Mitigation: touch_edge (Low≤UL / High≥LL) or touch_midpoint",
          "Invalidation: candle_close or wick_break",
          "Expiry: zone removed after InpExpiryBars bars (default 50)",
        ],
        output: [
          "ACTIVE → full opacity (InpActiveOpacity, default 70%)",
          "MITIGATED → faded opacity (InpMitigatedOpacity, default 25%)",
          "INVALIDATED / EXPIRED → removed or dotted relic",
          "Journal: FVG_CREATED | FVG_MITIGATED | FVG_INVALIDATED | FVG_EXPIRED",
          "Inputs: mitigation_mode · invalidation_mode · expiry_bars · show_mitigated",
        ],
        status: "ready",
        generate: generateFvgDetector,
      },
      {
        id: "fvg-inversion",
        filename: "FVG_Inversion_Detector.mq5",
        name: "FVG Inversion Detector",
        description:
          "Detects FVG polarity flips. When price closes through an FVG the zone " +
          "becomes an Inversion FVG of opposite direction. Key-level highlighting " +
          "marks the most structurally important IFVG per direction.",
        rules: [
          "Bullish FVG → BEARISH inversion when: Close < LL",
          "Bearish FVG → BULLISH inversion when: Close > UL",
          "Inversion zone uses same UL/LL as original FVG",
          "Key level: highest UL for bearish IFVGs / lowest LL for bullish IFVGs",
          "Invalidation: close back through → zone disappears entirely",
        ],
        output: [
          "Original FVG: solid fill → disappears on inversion",
          "Inversion zone: dashed fill, distinct colour (green/orchid)",
          "Key zone: full opacity + border width 2; non-key: faded",
          "Journal: FVG_INVERSION_CREATED | INV_INVALIDATED | id | dir | UL | LL | bar",
          "Inputs: highlight_key_level · show_only_key · key_opacity · non_key_opacity",
        ],
        status: "ready",
        generate: generateFvgInversionDetector,
      },
      {
        id: "order-block",
        filename: "OB_Detector.mq5",
        name: "Order Block Detector",
        description:
          "Detects Order Block zones — the last opposing candle before a strong " +
          "ATR-filtered displacement move. Full ACTIVE → MITIGATED → INVALIDATED / " +
          "EXPIRED lifecycle.",
        rules: [
          "Bullish OB: last BEARISH candle before a bullish displacement",
          "Bearish OB: last BULLISH candle before a bearish displacement",
          "Displacement: candle body ≥ InpDispMult × ATR(InpAtrPeriod) (default 1.5 × ATR14)",
          "Mitigation: barLow ≤ OB high (bull) or barHigh ≥ OB low (bear)",
          "Invalidation: close < OB low (bull) or close > OB high (bear)",
        ],
        output: [
          "ACTIVE → full opacity (InpActiveOpacity, default 70%)",
          "MITIGATED → faded opacity (InpMitOpacity, default 25%)",
          "INVALIDATED / EXPIRED → removed or dotted relic",
          "Journal: OB_CREATED | OB_MITIGATED | OB_INVALIDATED | OB_EXPIRED",
          "Inputs: atr_period · disp_multiplier · expiry_bars · show_mitigated",
        ],
        status: "ready",
        generate: generateObDetector,
      },
      {
        id: "breaker-block",
        filename: "BB_Detector.mq5",
        name: "Breaker Block Detector",
        description:
          "Detects Breaker Blocks — Order Blocks that failed and flipped polarity. " +
          "When price closes through an OB zone, it is recycled as a Breaker of the " +
          "opposite direction with its own lifecycle.",
        rules: [
          "Bearish OB + close above OB high → Bullish Breaker",
          "Bullish OB + close below OB low  → Bearish Breaker",
          "Breaker zone = original OB high / low (same price range, dashed border)",
          "Fires for both ACTIVE and MITIGATED OBs",
          "Expiry measured from breakerTime, not original obTime",
        ],
        output: [
          "ACTIVE Breaker → full opacity dashed zone",
          "MITIGATED Breaker → faded dashed zone",
          "Original OB shown via InpShowOriginalOb (hidden by default)",
          "Journal: OB_CREATED | BREAKER_CREATED | BREAKER_MITIGATED | BREAKER_INVALIDATED",
          "Inputs: bb_active_opacity · bb_mit_opacity · show_original_ob · expiry_bars",
        ],
        status: "ready",
        generate: generateBbDetector,
      },
      {
        id: "liquidity-sweep",
        filename: "LiqSweep_Detector.mq5",
        name: "Liquidity Sweep Detector",
        description:
          "Detects liquidity sweeps — candles whose wick pierces a confirmed swing " +
          "high/low and then close back inside. Sweeps move through " +
          "PENDING → CONFIRMED / EXPIRED with a configurable confirmation window.",
        rules: [
          "Swing high/low confirmed after N candles close on each side (InpSwingStr=3)",
          "Bullish sweep: barLow < swingLevel AND close > swingLevel",
          "Bearish sweep: barHigh > swingLevel AND close < swingLevel",
          "Same-bar confirmation: wick-break AND close-back on the same candle",
          "PENDING → EXPIRED if no close-back after InpMaxWaitBars (default 5)",
        ],
        output: [
          "Dashed OBJ_TREND line at swing level (swingTime → confirmTime)",
          "OBJ_TEXT label: 'Bull Sweep #N  Lvl:price'",
          "Journal: SWEEP_CONFIRMED | SWEEP_EXPIRED | id | dir | level | wick | bar",
          "Inputs: swing_strength · max_wait_bars · expiry_bars · show_bull · show_bear",
        ],
        status: "ready",
        generate: generateLiqSweepDetector,
      },
      {
        id: "swing-structure",
        filename: "Swing_Structure_Detector.mq5",
        name: "Swing Structure Detector",
        description:
          "Detects and marks confirmed pivot highs and pivot lows only. " +
          "No BOS. No CHoCH. No trend classification. " +
          "Use alongside BOS Detector and CHoCH Detector for the full picture.",
        rules: [
          "Swing High: high > N left bars AND M right bars (InpSwingLeft / InpSwingRight)",
          "Swing Low:  low  < N left bars AND M right bars",
          "A swing at shift s is confirmed when M right-side bars have closed",
          "Dedup by time — same candle cannot produce duplicate swing records",
        ],
        output: [
          "▼ OBJ_ARROW (code 234, width 1) at each swing high price",
          "▲ OBJ_ARROW (code 233, width 1) at each swing low price",
          "Toggleable per direction: InpShowHighs / InpShowLows",
          "Journal: SWING_HIGH_FORMED | SWING_LOW_FORMED | id | price | time",
        ],
        status: "ready",
        generate: generateSwingStructureDetector,
      },
      {
        id: "bos",
        filename: "BOS_Detector.mq5",
        name: "BOS Detector",
        description:
          "Break of Structure — price closes beyond a previous swing in the same " +
          "direction as the current trend. Trend state: 0 unknown / 1 bullish / -1 bearish. " +
          "CHoCH events update the trend state internally but are not drawn here.",
        rules: [
          "Trend state: 0 = unknown, 1 = bullish, −1 = bearish",
          "Bullish BOS: close > last swing high  AND trend ≠ −1 (was bull or unknown)",
          "Bearish BOS: close < last swing low   AND trend ≠ +1 (was bear or unknown)",
          "Trend is updated on every break (BOS or CHoCH) to stay in sync with CHoCH_Detector",
          "Confirmation: candle_close (default) or wick_break",
        ],
        output: [
          "STYLE_SOLID horizontal line from broken swing → break bar",
          "Bullish BOS: green  |  Bearish BOS: red",
          "Label 'BOS' anchored at break bar (above line for bull, below for bear)",
          "Journal: BULLISH_BOS | BEARISH_BOS | id | price | time | trend_before",
        ],
        status: "ready",
        generate: generateBosDetector,
      },
      {
        id: "choch",
        filename: "CHoCH_Detector.mq5",
        name: "CHoCH Detector",
        description:
          "Change of Character — price closes beyond a previous swing AGAINST the " +
          "current trend, signalling a potential reversal. Shares the same trend " +
          "state machine as BOS Detector — run both for the complete structure picture.",
        rules: [
          "Trend state: 0 = unknown, 1 = bullish, −1 = bearish",
          "Bullish CHoCH: close > last swing high  AND trend == −1 (was bearish)",
          "Bearish CHoCH: close < last swing low   AND trend == +1 (was bullish)",
          "BOS events update trend state internally but are not drawn here",
          "Confirmation: candle_close (default) or wick_break",
        ],
        output: [
          "STYLE_DASH horizontal line from broken swing → break bar",
          "Bullish CHoCH: blue  |  Bearish CHoCH: orange",
          "Label 'CHoCH' anchored at break bar (above line for bull, below for bear)",
          "Journal: BULLISH_CHOCH | BEARISH_CHOCH | id | price | time | trend_before",
        ],
        status: "ready",
        generate: generateChochDetector,
      },
      {
        id: "mitigation-block",
        filename: "MB_Detector.mq5",
        name: "Mitigation Block",
        description:
          "Detects Mitigation Blocks — price returns to a previously broken swing " +
          "high or low to mitigate unfilled orders before continuing in the original " +
          "direction. Tracks the mitigation target and confirmation.",
        rules: [
          "Bullish: price broke below a swing low, rallied, then returns to retest that low",
          "Bearish: price broke above a swing high, fell, then returns to retest that high",
          "Mitigation = close back inside the original swing range",
        ],
        output: [
          "Mitigation zone rectangle at the swing high / low",
          "Journal: MB_CREATED | MB_MITIGATED | id | dir | level | bar",
        ],
        status: "pending",
      },
    ],
  },

  // ── 2. Support & Resistance ───────────────────────────────────────────────
  {
    id: "snr",
    label: "SNR",
    fullName: "Support & Resistance",
    icon: Minus,
    phaseTag: "Roadmap",
    phaseActive: false,
    description:
      "Classic and advanced support/resistance concepts. Each module detects, " +
      "visualises, and tracks the lifecycle of a specific S/R behaviour — " +
      "from raw horizontal levels to complex polarity-flip and rejection patterns.",
    modules: [
      {
        id: "classic-snr",
        filename: "SNR_Classic_Detector.mq5",
        name: "Classic SNR",
        description:
          "Detects horizontal S/R levels from swing highs and lows. Tracks zone " +
          "strength by counting price touches and logs each test.",
        status: "planned",
      },
      {
        id: "gap-snr",
        filename: "SNR_Gap_Detector.mq5",
        name: "Gap SNR",
        description:
          "Identifies price gaps (windows) that act as S/R levels. Tracks whether " +
          "the gap has been filled or is still acting as a magnet.",
        status: "planned",
      },
      {
        id: "breakout",
        filename: "SNR_Breakout_Detector.mq5",
        name: "Breakout",
        description:
          "Detects clean breakouts above resistance or below support. Configurable " +
          "body-size and ATR filters to distinguish genuine breaks from fakeouts.",
        status: "planned",
      },
      {
        id: "rbs-sbr",
        filename: "SNR_RBS_SBR_Detector.mq5",
        name: "RBS / SBR",
        description:
          "Resistance Becomes Support / Support Becomes Resistance — marks polarity " +
          "flips on confirmed breakouts and tracks subsequent retests.",
        status: "planned",
      },
      {
        id: "rejection",
        filename: "SNR_Rejection_Detector.mq5",
        name: "Rejection",
        description:
          "Detects strong wicks rejecting from a key level. The candle tests the " +
          "level but the close back inside confirms the rejection.",
        status: "planned",
      },
      {
        id: "miss",
        filename: "SNR_Miss_Detector.mq5",
        name: "Miss",
        description:
          "Identifies candles that approached but failed to reach a key level — " +
          "the classic 'miss' setup where orders were filled before price touched.",
        status: "planned",
      },
      {
        id: "multi-rejection",
        filename: "SNR_MultiReject_Detector.mq5",
        name: "Multiple Rejection",
        description:
          "Tracks levels that have been rejected 2 or more times. Zone strength " +
          "score increments with each rejection and resets on a clean breakout.",
        status: "planned",
      },
      {
        id: "equilibrium",
        filename: "SNR_Equilibrium_Detector.mq5",
        name: "Equilibrium",
        description:
          "Marks the 50% midpoint (equilibrium) of a swing range — the key " +
          "boundary between premium and discount zones.",
        status: "planned",
      },
      {
        id: "rss-srr",
        filename: "SNR_RSS_SRR_Detector.mq5",
        name: "RSS / SRR",
        description:
          "Resistance Stays Resistance / Support Stays Resistance — tracks levels " +
          "that have been tested multiple times without flipping polarity.",
        status: "planned",
      },
    ],
  },

  // ── 3. Supply & Demand ────────────────────────────────────────────────────
  {
    id: "supply-demand",
    label: "S&D",
    fullName: "Supply & Demand",
    icon: ArrowUpDown,
    phaseTag: "Roadmap",
    phaseActive: false,
    description:
      "Institutional supply and demand zone detection based on base-and-move " +
      "patterns. Each module handles a specific zone type — from fresh untested " +
      "zones to flip zones that have changed polarity.",
    modules: [
      {
        id: "supply-zone",
        filename: "SD_Supply_Detector.mq5",
        name: "Supply Zone",
        description:
          "Marks supply zones using drop-base-drop (DBD) and rally-base-drop " +
          "(RBD) patterns. The base candles form the zone rectangle.",
        status: "planned",
      },
      {
        id: "demand-zone",
        filename: "SD_Demand_Detector.mq5",
        name: "Demand Zone",
        description:
          "Marks demand zones using rally-base-rally (RBR) and drop-base-rally " +
          "(DBR) patterns. Tracks mitigation and invalidation of each zone.",
        status: "planned",
      },
      {
        id: "fresh-zone",
        filename: "SD_Fresh_Detector.mq5",
        name: "Fresh Zone",
        description:
          "Highlights supply/demand zones that have not yet been retested by " +
          "price — statistically the highest-probability zones.",
        status: "planned",
      },
      {
        id: "mitigated-zone",
        filename: "SD_Mitigated_Detector.mq5",
        name: "Mitigated Zone",
        description:
          "Identifies zones where price has returned and partially or fully " +
          "consumed the unfilled orders. Tracks the mitigation percentage.",
        status: "planned",
      },
      {
        id: "flip-zone",
        filename: "SD_Flip_Detector.mq5",
        name: "Flip Zone",
        description:
          "Detects supply/demand zones that have flipped polarity — former " +
          "supply that has become a demand zone and vice versa.",
        status: "planned",
      },
      {
        id: "nested-zone",
        filename: "SD_Nested_Detector.mq5",
        name: "Nested Zone",
        description:
          "Identifies supply/demand zones that contain smaller zones within " +
          "them — confluence of two timeframe zones in one area.",
        status: "planned",
      },
    ],
  },

  // ── 4. Engulfing ──────────────────────────────────────────────────────────
  {
    id: "engulfing",
    label: "Engulfing",
    fullName: "Engulfing Patterns",
    icon: Activity,
    phaseTag: "Roadmap",
    phaseActive: false,
    description:
      "Candle-based engulfing pattern detection from single-candle setups to " +
      "multi-timeframe alignment. Each module is standalone and " +
      "independently verifiable on a chart.",
    modules: [
      {
        id: "bull-engulf",
        filename: "ENG_Bull_Detector.mq5",
        name: "Bullish Engulfing",
        description:
          "Detects candles whose body fully engulfs the prior candle's body " +
          "with bullish bias. Configurable wick-body ratio filter.",
        status: "planned",
      },
      {
        id: "bear-engulf",
        filename: "ENG_Bear_Detector.mq5",
        name: "Bearish Engulfing",
        description:
          "Detects candles whose body fully engulfs the prior candle's body " +
          "with bearish bias. Includes ATR-size filter to eliminate small patterns.",
        status: "planned",
      },
      {
        id: "engulf-failed",
        filename: "ENG_Failed_Detector.mq5",
        name: "Engulfing Failed (EG-EF)",
        description:
          "Tracks engulfing patterns that subsequently fail — price reverses " +
          "through the engulfing candle's origin, confirming the failure.",
        status: "planned",
      },
      {
        id: "transformation",
        filename: "ENG_Transform_Detector.mq5",
        name: "Transformation",
        description:
          "Detects when a candle transforms the prior candle's structure — " +
          "e.g., a pin bar that gets engulfed and transforms into a continuation.",
        status: "planned",
      },
      {
        id: "mtf-engulf",
        filename: "ENG_MTF_Detector.mq5",
        name: "Multi-Timeframe Engulfing",
        description:
          "Identifies engulfing patterns that align across two or more " +
          "timeframes simultaneously — higher-timeframe body engulfs lower-timeframe structure.",
        status: "planned",
      },
    ],
  },

  // ── 5. Indicators ─────────────────────────────────────────────────────────
  {
    id: "indicators",
    label: "Indicators",
    fullName: "Classic Indicators",
    icon: BarChart2,
    phaseTag: "Roadmap",
    phaseActive: false,
    description:
      "Standalone wrappers for classic technical indicators. Each module " +
      "provides detection logic, configurable alerts, and journal logging — " +
      "ready to combine with SMC or S/R modules in a strategy.",
    modules: [
      {
        id: "ema",
        filename: "IND_EMA_Detector.mq5",
        name: "EMA",
        description:
          "Exponential Moving Average with multi-period support (8, 21, 50, 200), " +
          "cross detection, and price-vs-EMA position logging.",
        status: "planned",
      },
      {
        id: "sma",
        filename: "IND_SMA_Detector.mq5",
        name: "SMA",
        description:
          "Simple Moving Average with golden/death cross detection and " +
          "configurable periods.",
        status: "planned",
      },
      {
        id: "rsi",
        filename: "IND_RSI_Detector.mq5",
        name: "RSI",
        description:
          "Relative Strength Index with overbought/oversold level alerts and " +
          "hidden/regular divergence detection.",
        status: "planned",
      },
      {
        id: "macd",
        filename: "IND_MACD_Detector.mq5",
        name: "MACD",
        description:
          "MACD line, signal line, and histogram with crossover and zero-line " +
          "cross logging.",
        status: "planned",
      },
      {
        id: "atr",
        filename: "IND_ATR_Detector.mq5",
        name: "ATR",
        description:
          "Average True Range for volatility measurement — dynamic threshold " +
          "bands and volatility-state logging (low / normal / high).",
        status: "planned",
      },
      {
        id: "bbands",
        filename: "IND_BBands_Detector.mq5",
        name: "Bollinger Bands",
        description:
          "Volatility bands with squeeze detection, band-walk alerts, and " +
          "percent-B value logging.",
        status: "planned",
      },
      {
        id: "stochastic",
        filename: "IND_Stoch_Detector.mq5",
        name: "Stochastic",
        description:
          "Stochastic Oscillator with K/D line cross alerts and overbought / " +
          "oversold zone detection.",
        status: "planned",
      },
      {
        id: "vwap",
        filename: "IND_VWAP_Detector.mq5",
        name: "VWAP",
        description:
          "Volume Weighted Average Price with ±1σ / ±2σ deviation bands and " +
          "price-vs-VWAP position logging.",
        status: "planned",
      },
      {
        id: "supertrend",
        filename: "IND_SuperTrend_Detector.mq5",
        name: "SuperTrend",
        description:
          "ATR-based trend direction indicator with flip signal logging and " +
          "configurable ATR multiplier.",
        status: "planned",
      },
      {
        id: "other-indicators",
        filename: "IND_Custom_Detector.mq5",
        name: "Other Indicators",
        description:
          "Additional indicators built on request — EMA ribbon, Ichimoku cloud, " +
          "Parabolic SAR, Williams %R, CCI, and more.",
        status: "planned",
      },
    ],
  },
];

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ModuleStatus }) {
  if (status === "ready") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1 shrink-0">
        <CheckCircle2 className="h-2.5 w-2.5" /> Ready
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1 shrink-0">
        <Clock className="h-2.5 w-2.5" /> Coming soon
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground/60 border border-border/40 flex items-center gap-1 shrink-0">
      <Rocket className="h-2.5 w-2.5" /> Planned
    </span>
  );
}

// ─── Module card ─────────────────────────────────────────────────────────────

function ModuleCard({ mod }: { mod: ModuleEntry }) {
  const isReady = mod.status === "ready";

  const handleDownload = () => {
    if (!mod.generate) return;
    try {
      downloadMql5(mod.filename, mod.generate());
      toast.success(`${mod.filename} downloaded — open in MetaEditor and compile`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  return (
    <div
      className={`rounded-lg border bg-card p-5 flex flex-col gap-4 transition-opacity ${
        isReady
          ? "border-border"
          : mod.status === "pending"
          ? "border-border/60 opacity-75"
          : "border-border/30 opacity-50"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <h3 className="font-semibold text-sm">{mod.name}</h3>
            <StatusBadge status={mod.status} />
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

      {/* Rules + Output — only shown when specified */}
      {mod.rules && mod.rules.length > 0 && (
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
          {mod.output && mod.output.length > 0 && (
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
          )}
        </div>
      )}

      {/* Filename */}
      <div className="text-[10px] text-muted-foreground/50 font-mono border-t border-border/40 pt-2">
        {mod.filename}
      </div>
    </div>
  );
}

// ─── Category tab content ─────────────────────────────────────────────────────

function CategoryPanel({ category }: { category: ModuleCategory }) {
  const readyCount   = category.modules.filter((m) => m.status === "ready").length;
  const pendingCount = category.modules.filter((m) => m.status === "pending").length;

  return (
    <div className="space-y-4">
      {/* Category banner */}
      <div className="rounded-lg border border-border/60 bg-card/50 px-4 py-3 flex items-start gap-3">
        <category.icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{category.fullName}</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                category.phaseActive
                  ? "bg-primary/10 text-primary border-primary/20"
                  : "bg-muted text-muted-foreground border-border"
              }`}
            >
              {category.phaseTag}
            </span>
            {readyCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {readyCount} ready
              </span>
            )}
            {pendingCount > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {pendingCount} in progress
              </span>
            )}
          </div>
          <p>{category.description}</p>
        </div>
      </div>

      {/* Module cards */}
      <div className="space-y-3">
        {category.modules.map((mod) => (
          <ModuleCard key={mod.id} mod={mod} />
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function ModulesPage() {
  const totalReady = TRADING_MODULES.reduce(
    (sum, cat) => sum + cat.modules.filter((m) => m.status === "ready").length,
    0,
  );
  const totalModules = TRADING_MODULES.reduce(
    (sum, cat) => sum + cat.modules.length,
    0,
  );

  return (
    <div>
      <PageHeader
        title="Trading Modules"
        subtitle="Modular trading concept engine — standalone detection, visualisation, and lifecycle modules across every major trading methodology."
      />

      <div className="p-6 space-y-6 max-w-5xl">

        {/* Architecture banner */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 flex items-start gap-3">
          <FlaskConical className="h-4 w-4 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-primary/80 space-y-1">
            <p className="font-semibold text-primary">
              Phase 1: Detection only — {totalReady} of {totalModules} modules ready
            </p>
            <p>
              Each module is a standalone MQL5 indicator. Download → compile in MetaEditor →
              attach to a chart → verify visually before any execution logic is added.
            </p>
            <p>
              <span className="font-medium">Architecture:</span>{" "}
              Phase 1 Detection → Phase 2 State → Phase 3 Execution.
              Modules are independently testable and composable.
            </p>
          </div>
        </div>

        {/* Category tabs */}
        <Tabs defaultValue="smc">
          <div className="overflow-x-auto pb-1">
            <TabsList className="inline-flex h-auto gap-1 p-1">
              {TRADING_MODULES.map((cat) => {
                const ready = cat.modules.filter((m) => m.status === "ready").length;
                const Icon  = cat.icon;
                return (
                  <TabsTrigger
                    key={cat.id}
                    value={cat.id}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs"
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{cat.label}</span>
                    {ready > 0 && (
                      <span className="ml-0.5 text-[10px] px-1 py-0 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
                        {ready}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {TRADING_MODULES.map((cat) => (
            <TabsContent key={cat.id} value={cat.id} className="mt-4">
              <CategoryPanel category={cat} />
            </TabsContent>
          ))}
        </Tabs>

        {/* Road map footer */}
        <div className="text-xs text-muted-foreground border-t border-border pt-4 space-y-1">
          <p className="font-medium text-foreground/60">Road map</p>
          <p>Phase 2 — State modules: retest, mitigation, invalidation, expiry logic</p>
          <p>Phase 3 — Execution modules: entry timing, SL, TP, break-even, trailing</p>
          <p>Phase 4 — Composition: combine modules from any category into a full EA strategy</p>
        </div>
      </div>
    </div>
  );
}
