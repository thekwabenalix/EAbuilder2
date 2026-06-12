import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Download,
  CheckCircle2,
  Clock,
  Rocket,
  FlaskConical,
  TrendingUp,
  Minus,
  ArrowUpDown,
  BarChart2,
  Layers,
  Zap,
  Network,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { generateFvgDetector } from "@/lib/smc-modules/fvg-detector";
import { generateFvgInversionDetector } from "@/lib/smc-modules/fvg-inversion-detector";
import { generateObDetector } from "@/lib/smc-modules/ob-detector";
import { generateBbDetector } from "@/lib/smc-modules/bb-detector";
import { generateFvgLiquidityDetector } from "@/lib/smc-modules/fvg-liquidity-detector";
import { generateObLiquidityDetector } from "@/lib/smc-modules/ob-liquidity-detector";
import { generateBbLiquidityDetector } from "@/lib/smc-modules/bb-liquidity-detector";
import { generateZoneLiquiditySetupIndicator } from "@/lib/smc-modules/zone-liquidity-setup-indicator";
import { generateZoneLiqStateModule } from "@/lib/smc-modules/zone-liq-state-module";
import { generateObFvgDetector } from "@/lib/smc-modules/ob-fvg-detector";
import { generateUnicornDetector } from "@/lib/smc-modules/unicorn-detector";
import { generateRsiHiddenDivergenceDetector } from "@/lib/indicator-modules/rsi-hidden-divergence-detector";
import { generateRsiHiddenDivergenceStateModule } from "@/lib/indicator-modules/rsi-hidden-divergence-state-module";
import { generateLiqSweepDetector } from "@/lib/smc-modules/liqsweep-detector";
import { generateSwingStructureDetector } from "@/lib/smc-modules/swing-structure-detector";
import { generateBosDetector } from "@/lib/smc-modules/bos-detector";
import { generateChochDetector } from "@/lib/smc-modules/choch-detector";
import { generateClassicSnrDetector } from "@/lib/smc-modules/classic-snr-detector";
import { generateGapSnrDetector } from "@/lib/smc-modules/gap-snr-detector";
import { generateBreakoutDetector } from "@/lib/smc-modules/breakout-detector";
import { generateRejectionDetector } from "@/lib/smc-modules/rejection-detector";
import { generateMissDetector } from "@/lib/smc-modules/miss-detector";
import { generateEngulfingDetector } from "@/lib/smc-modules/engulfing-detector";
import { generateStrongEngulfingDetector } from "@/lib/smc-modules/strong-engulfing-detector";
import { generateRbrDbdDetector } from "@/lib/smc-modules/rbr-dbd-detector";
import { generateMefDetector } from "@/lib/smc-modules/mef-detector";
import { generateQmMefDetector } from "@/lib/smc-modules/qm-mef-detector";
import { generateSnrc2Detector } from "@/lib/smc-modules/snrc2-detector";
import { INDICATOR_REGISTRY, INDICATOR_CATEGORY_LABEL } from "@/lib/indicator-registry";
import { generateFvgStateModule } from "@/lib/smc-modules/fvg-state-module";
import { generateObStateModule } from "@/lib/smc-modules/ob-state-module";
import { generateBreakoutStateModule } from "@/lib/smc-modules/breakout-state-module";
import { generateRejectionStateModule } from "@/lib/smc-modules/rejection-state-module";
import { generateMissStateModule } from "@/lib/smc-modules/miss-state-module";
import { generateRssSrrDetector } from "@/lib/smc-modules/rss-srr-detector";
import { generateRssSrrStateModule } from "@/lib/smc-modules/rss-srr-state-module";
import { generateBosStateModule } from "@/lib/smc-modules/bos-state-module";
import { generateBbStateModule } from "@/lib/smc-modules/bb-state-module";
import { generateLiqSweepStateModule } from "@/lib/smc-modules/liqsweep-state-module";
import { generateFvgInversionStateModule } from "@/lib/smc-modules/fvg-inversion-state-module";
import { generateChochStateModule } from "@/lib/smc-modules/choch-state-module";
import { generateClassicSnrStateModule } from "@/lib/smc-modules/classic-snr-state-module";
import { generateGapSnrStateModule } from "@/lib/smc-modules/gap-snr-state-module";
import { generateFvgExecutionEa } from "@/lib/phase3-modules/fvg-execution-ea";
import {
  generatePhase3Ea,
  OB_EA_CONFIG,
  BREAKOUT_EA_CONFIG,
  BB_EA_CONFIG,
  LIQSWEEP_EA_CONFIG,
  IFVG_EA_CONFIG,
  CLASSIC_SNR_EA_CONFIG,
  GAP_SNR_EA_CONFIG,
} from "@/lib/phase3-modules/state-module-ea";
import {
  generateMtfOrchestrator,
  FVG_3TF_BULL,
  FVG_3TF_BEAR,
  FVG_2TF_BULL,
  FVG_2TF_BEAR,
  OB_3TF_BULL,
  OB_3TF_BEAR,
  OB_2TF_BULL,
  OB_2TF_BEAR,
  BREAKOUT_2TF_BULL,
  BREAKOUT_2TF_BEAR,
  BB_2TF_BULL,
  BB_2TF_BEAR,
  BOS_BIAS_FVG_BULL,
  BOS_BIAS_FVG_BEAR,
  BOS_BIAS_OB_BULL,
  BOS_BIAS_OB_BEAR,
  BOS_OB_FVG_BULL,
  BOS_OB_FVG_BEAR,
} from "@/lib/mtf-modules/mtf-orchestrator";
import { ALL_BRAIN_MODULES } from "@/lib/brain-modules";
import { getModuleContract, MODULE_CONTRACTS } from "@/lib/module-contracts";
import {
  MODULE_ADMISSION,
  MODULE_ADMISSION_STATUS_META,
  type ModuleAdmissionStatus,
} from "@/lib/module-admission";

export const Route = createFileRoute("/modules")({
  component: ModulesPage,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function downloadMql5(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ModuleStatus = "ready" | "pending" | "planned" | "builtin";

/** How this file is meant to be used — not the same as Strategy Builder brain slots. */
type ModuleCatalogKind =
  | "standalone_indicator"
  | "state_module"
  | "full_ea"
  | "brain_composable";

interface ModuleEntry {
  id: string;
  filename: string;
  name: string;
  description: string;
  rules?: string[];
  output?: string[];
  status: ModuleStatus;
  generate?: () => string;
  catalogKind?: ModuleCatalogKind;
}

interface ModuleCategory {
  id: string;
  label: string; // short tab label
  fullName: string; // expanded name
  icon: LucideIcon;
  phaseTag: string; // e.g. "Phase 1 Active" | "Roadmap"
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
          "Clean Break of Structure detector. Bullish BOS when close > swing high, " +
          "Bearish BOS when close < swing low. BOS lines are automatically removed " +
          "when price closes back through them. Filters reduce noise.",
        rules: [
          "Bullish BOS: close > unconsumed swing high → solid green line",
          "Bearish BOS: close < unconsumed swing low  → solid red line",
          "Each swing can only generate one BOS (consumed flag prevents duplicates)",
          "BOS REMOVED when close goes back through the level (self-cleaning)",
          "Pivot filter: InpPivotLen=5 bars each side (reduces minor pivot noise)",
          "Distance filter: InpMinSwingPts — new swing must differ by N points from previous (0=off)",
          "ATR filter: InpUseAtrFilt=true → use InpAtrMult × ATR instead of fixed points",
          "Max lines: InpMaxBosLines=20 — oldest active BOS removed when limit exceeded",
        ],
        output: [
          "STYLE_SOLID horizontal line from swing candle → break bar",
          "Label 'Bull BOS' / 'Bear BOS' anchored at break bar",
          "Invalidated lines deleted immediately from the chart",
          "Journal: BULLISH_BOS | BEARISH_BOS | BOS_INVALIDATED | id | price | time",
          "No arrows. No swing markers. No CHoCH. No trend state.",
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
      {
        id: "zone-liquidity-setup",
        filename: "Zone_Liquidity_Setup.mq5",
        name: "Zone Liquidity Setup (FVG + OB + BB)",
        description:
          "Unified setup indicator — detects FVG, Order Block, or Breaker Block zones, " +
          "waits for liquidity (one+ bars close near the zone without touching), then " +
          "requires a tap into the zone and a rejection close back outside. " +
          "Buy/sell arrows mark entry at the next bar open; gold dotted line = suggested SL beyond the zone.",
        rules: [
          "Zone: FVG (3-candle gap), OB (displacement + opposite candle), or BB (OB closed through → polarity flip)",
          "Liquidity: bar closes within proximity of the zone edge without wick entering the zone",
          "Fresh-only: zone rectangle removed the instant price touches/tests the zone (wick overlap)",
          "Setup signal: if liquidity was built, test bar closes back outside → entry next open",
          "Toggle InpUseFVG / InpUseOB / InpUseBB to enable each zone type",
        ],
        output: [
          "Filled zone rectangles (green bull / red bear)",
          "Blue up-arrow = buy setup; red down-arrow = sell setup (next-bar entry)",
          "Gold dotted SL line on rejection bar",
          "Journal: ZLS BUY/SELL | kind | tap+reject | SL | entry next open",
        ],
        status: "ready",
        generate: generateZoneLiquiditySetupIndicator,
        catalogKind: "brain_composable",
      },
      {
        id: "fvg-liquidity",
        filename: "FVG_Liquidity_Detector.mq5",
        name: "FVG Liquidity Detector",
        description:
          "Liquidity build-up around a Fair Value Gap — one or more candles come " +
          "close to an FVG but fail to enter it. The resting stops that accumulate " +
          "turn the gap into a higher-probability reaction level. The closest-approach " +
          "candle is labeled 'FLq'; entering the gap kills the level.",
        rules: [
          "FVG: 3-candle gap — Bullish C1.high<C3.low (near edge=C3.low), Bearish C1.low>C3.high (near edge=C3.high)",
          "Proximity auto-scales: InpNearATR × ATR(14), or fixed InpNearPoints override",
          "Liquidity = wick within proximity of the gap edge WITHOUT entering the gap",
          "Touch (wick low<=gap top for bull / high>=gap bottom for bear) kills the level",
          "Closest approach wins — label moves to a nearer candle if one appears",
          "Levels expire after InpExpiryBars bars (0 = never)",
        ],
        output: [
          "Filled rectangle marking the FVG gap (extends to the live bar; removed when consumed)",
          "'FLq' label on the closest-approach candle (above wick for bear, below for bull)",
          "Journal: FVG_LIQ_BULL | FVG_LIQ_BEAR | gap | wick | dist pts | time",
          "Inputs: InpNearATR (0.20) · InpATRPeriod (14) · InpNearPoints override · InpDrawZone · expiry_bars",
        ],
        status: "ready",
        generate: generateFvgLiquidityDetector,
        catalogKind: "standalone_indicator",
      },
      {
        id: "ob-liquidity",
        filename: "OB_Liquidity_Detector.mq5",
        name: "OB Liquidity Detector",
        description:
          "Liquidity build-up around an Order Block — candles approach the OB but " +
          "fail to touch its BODY. The accumulated liquidity makes the OB a stronger " +
          "reaction level. The closest-approach candle is labeled 'OLq'; touching the " +
          "OB body kills the level.",
        rules: [
          "OB: displacement-based (body>=InpDispMult×ATR); Bull OB=last bearish candle, Bear OB=last bullish candle",
          "Body near-edge = the OB candle's OPEN (body top for bull OB, body bottom for bear OB)",
          "Liquidity = wick within proximity of the body edge WITHOUT touching the body",
          "Touch (wick low<=obOpen for bull / high>=obOpen for bear) kills the level",
          "Proximity = InpNearATR × ATR(14), or fixed InpNearPoints override",
          "Levels expire after InpExpiryBars bars (0 = never)",
        ],
        output: [
          "Filled rectangle marking the OB body (open→close; extends to live bar; removed when consumed)",
          "'OLq' label on the closest-approach candle",
          "Journal: OB_LIQ_BULL | OB_LIQ_BEAR | body | wick | dist pts | time",
          "Inputs: disp_mult · ob_scan_back · InpNearATR (0.20) · near_points override · InpDrawZone · expiry_bars",
        ],
        status: "ready",
        generate: generateObLiquidityDetector,
        catalogKind: "standalone_indicator",
      },
      {
        id: "bb-liquidity",
        filename: "BB_Liquidity_Detector.mq5",
        name: "BB Liquidity Detector",
        description:
          "Liquidity build-up around a Breaker Block — price does not touch the " +
          "breaker's BODY but accumulates around it. An OB that gets closed through " +
          "flips polarity into a breaker; liquidity then builds on its flipped body. " +
          "The closest-approach candle is labeled 'BLq'; touching the body kills it.",
        rules: [
          "OB detected via displacement, then becomes a BREAKER when price CLOSES through its zone",
          "Bullish OB broken DOWN → Bear Breaker (resistance); Bearish OB broken UP → Bull Breaker (support)",
          "Breaker body near-edge = the original OB candle's CLOSE (polarity flips the edge from open to close)",
          "Liquidity = wick within proximity of the breaker body edge WITHOUT touching it",
          "Touch (low<=obClose for bull breaker / high>=obClose for bear breaker) kills the level",
          "Unbroken OBs expire after InpObExpiry bars; breakers expire after InpBBExpiry bars",
        ],
        output: [
          "Dashed filled rectangle marking the breaker body (drawn on flip; removed when consumed)",
          "'BLq' label on the closest-approach candle",
          "Journal: BB_FORMED | BB_LIQ_BULL | BB_LIQ_BEAR | body | wick | dist pts | time",
          "Inputs: disp_mult · ob_scan_back · InpNearATR (0.20) · near_points override · InpDrawZone · ob_expiry · bb_expiry",
        ],
        status: "ready",
        generate: generateBbLiquidityDetector,
        catalogKind: "standalone_indicator",
      },
      {
        id: "ob-fvg",
        filename: "OB_FVG_Detector.mq5",
        name: "OB + FVG",
        description:
          "Combination setup — a Fair Value Gap whose FIRST candle is the opposite " +
          "colour to the gap. That first candle IS the order block. A bullish OB+FVG " +
          "is a bullish FVG with a bearish first candle; a bearish OB+FVG is a bearish " +
          "FVG with a bullish first candle. Entry at the OB (first candle) body.",
        rules: [
          "3-candle FVG: C1 = oldest, C3 = newest",
          "Bullish OB+FVG: high(C1) < low(C3) (bullish gap) AND C1 is bearish",
          "Bearish OB+FVG: low(C1) > high(C3) (bearish gap) AND C1 is bullish",
          "The OB = C1's body; entry zone = OB body",
          "FRESH zones only — the setup is removed the instant price tests the OB body (wick into it) or trades through",
        ],
        output: [
          "Solid filled box on the OB (C1) body + dotted box on the FVG (extend to live bar)",
          "'OB+FVG' label at the OB; zone removed once tested/traded (fresh only) or on expiry",
          "Journal: OBFVG_BULL/BEAR | obBody | fvg | time  ·  OBFVG_*_TESTED when consumed",
          "Inputs: expiry_bars · colors",
        ],
        status: "ready",
        generate: generateObFvgDetector,
      },
      {
        id: "unicorn",
        filename: "Unicorn_Detector.mq5",
        name: "Unicorn (BB + FVG)",
        description:
          "The ICT Unicorn — a Breaker Block whose zone overlaps a Fair Value Gap of " +
          "the same (flipped) direction. The breaker∩FVG overlap is a high-probability " +
          "entry pocket. Combines Order Block → Breaker tracking with FVG detection.",
        rules: [
          "Detect OB via displacement; track until price CLOSES through → flips to a Breaker",
          "Bullish Unicorn: bull Breaker (bearish OB broken up) overlapping a bullish FVG",
          "Bearish Unicorn: bear Breaker (bullish OB broken down) overlapping a bearish FVG",
          "Match requires same direction, price overlap, and proximity within InpPairWindow bars",
          "Entry pocket = overlap [max(lo), min(top)] of breaker zone and FVG gap",
          "INVALIDATED when price closes back through the breaker zone",
        ],
        output: [
          "Dashed breaker box + solid width-2 overlap pocket + 'Unicorn' label",
          "Journal: UNICORN_BULL | UNICORN_BEAR | overlap | time",
          "Inputs: disp_mult · ob_scan_back · InpPairWindow · ob_expiry · uni_expiry · colors",
        ],
        status: "ready",
        generate: generateUnicornDetector,
      },
    ],
  },

  // ── 2. Support & Resistance ───────────────────────────────────────────────
  {
    id: "snr",
    label: "SNR",
    fullName: "Support & Resistance",
    icon: Minus,
    phaseTag: "Phase 1 Active",
    phaseActive: true,
    description:
      "Classic and advanced support/resistance concepts. Each module detects, " +
      "visualises, and tracks the lifecycle of a specific S/R behaviour — " +
      "from raw horizontal levels to complex polarity-flip and rejection patterns.",
    modules: [
      {
        id: "classic-snr",
        filename: "Classic_SNR_Detector.mq5",
        name: "Classic SNR Detector",
        description:
          "Detects Classic S/R levels from candle-pair direction reversals. " +
          "Candle A close becomes the level; Candle B direction determines type. " +
          "Full ACTIVE → TOUCHED → BROKEN / EXPIRED lifecycle with configurable expiry.",
        rules: [
          "RESISTANCE: Bullish Candle A → Bearish Candle B  (A close = resistance)",
          "SUPPORT:    Bearish Candle A → Bullish Candle B  (A close = support)",
          "Doji filter: InpIgnoreDoji=true skips neutral candles (exact or body threshold)",
          "Touched: wick reaches level (low ≤ level for support / high ≥ level for resistance)",
          "Broken:  close through level (close < level for support / close > level for resistance)",
          "Expiry: InpExpiryBars=100 bars — ageCounter increments each bar after confirmation",
          "Max visible: InpMaxLevels=100 — oldest active level pruned when exceeded",
        ],
        output: [
          "ACTIVE / TOUCHED: solid OBJ_TREND line + 'C-Sup' / 'C-Res' label, RAY_RIGHT=true",
          "BROKEN / EXPIRED: dashed line stopped at break bar (or deleted if InpRemoveBroken=true)",
          "Support: clrMediumSeaGreen  |  Resistance: clrTomato  |  Broken: clrDimGray",
          "Journal: SNR_CREATED | SNR_TOUCHED | SNR_BROKEN | SNR_EXPIRED | id | type | level | time",
          "Inputs: show_support · show_resistance · expiry_bars · remove_broken · max_levels · ignore_doji",
        ],
        status: "ready",
        generate: generateClassicSnrDetector,
      },
      {
        id: "gap-snr",
        filename: "Gap_SNR_Detector.mq5",
        name: "Gap SNR Detector",
        description:
          "Detects Gap S/R levels from candle-pair direction continuation. " +
          "When two consecutive candles move the same way, Candle A's close " +
          "marks a momentum level that often acts as future S/R.",
        rules: [
          "GAP SUPPORT:    Bullish Candle A → Bullish Candle B  (A close = support)",
          "GAP RESISTANCE: Bearish Candle A → Bearish Candle B  (A close = resistance)",
          "Doji filter: InpIgnoreDoji=true skips neutral candles (exact or body threshold)",
          "Touched: wick reaches level (low ≤ level for support / high ≥ level for resistance)",
          "Broken:  close through level (close < level for support / close > level for resistance)",
          "Expiry: InpExpiryBars=100 bars — ageCounter increments each bar after confirmation",
          "Max visible: InpMaxLevels=100 — oldest active level pruned when exceeded",
        ],
        output: [
          "ACTIVE / TOUCHED: solid OBJ_TREND line + 'G-Sup' / 'G-Res' label, RAY_RIGHT=true",
          "BROKEN / EXPIRED: dashed line stopped at break bar (or deleted if InpRemoveBroken=true)",
          "Support: clrDodgerBlue  |  Resistance: clrDarkOrange  |  Broken: clrSlateGray",
          "Journal: SNR_CREATED | SNR_TOUCHED | SNR_BROKEN | SNR_EXPIRED | id | type | level | time",
          "Inputs: show_support · show_resistance · expiry_bars · remove_broken · max_levels · ignore_doji",
        ],
        status: "ready",
        generate: generateGapSnrDetector,
      },
      {
        id: "breakout",
        filename: "Breakout_Detector.mq5",
        name: "Breakout Detector",
        description:
          "Detects candle-close breakouts of Classic SNR levels. On confirmation, the " +
          "broken level automatically flips to RBS (Resistance Becomes Support) or SBR " +
          "(Support Becomes Resistance). Embeds Classic SNR detection internally — " +
          "Gap SNR is ignored. Lifecycle: Classic SNR → Broken → RBS/SBR Active → Retested → Invalidated/Expired.",
        rules: [
          "Bullish BO: candle CLOSE > Classic Resistance level (wick break does NOT count)",
          "Bearish BO: candle CLOSE < Classic Support level   (wick break does NOT count)",
          "Classic SNR embedded: Bull→Bear pair = Resistance; Bear→Bull pair = Support (A close = level)",
          "CONFIRMED → RBS/SBR: first bar after breakout without closing back through — zone flips",
          "RBS (Resistance Becomes Support): Bullish BO confirmed → Buy Zone (green, width 2)",
          "SBR (Support Becomes Resistance): Bearish BO confirmed → Sell Zone (orange-red, width 2)",
          "RETESTED: wick returns to level from correct side without closing through",
          "INVALIDATED: close back through the broken level (failed flip zone)",
          "EXPIRED: InpExpiryBars (default 100) bars elapsed without invalidation",
          "Filters: InpMinBodyPts (body size) · InpMinBreakDist (points) · InpUseAtrFilt (ATR × mult)",
        ],
        output: [
          "ACTIVE: OBJ_TREND line + 'Bull BO'/'Bear BO' label + ▲/▼ arrow, width 1",
          "CONFIRMED: label → 'RBS'/'SBR', line width → 2, colour → clrMediumSeaGreen / clrOrangeRed",
          "RETESTED: line turns clrGold  |  Invalidated: dashed clrDimGray or deleted",
          "Inputs: show_rbs_sbr · rbs_color · sbr_color · expiry_bars · remove_invalid · max_breakouts",
          "Journal: BREAKOUT_CREATED | RBS_ACTIVE | SBR_ACTIVE | RBS_RETESTED | SBR_RETESTED | RBS_INVALIDATED | SBR_INVALIDATED | RBS_EXPIRED | SBR_EXPIRED",
        ],
        status: "ready",
        generate: generateBreakoutDetector,
      },
      {
        id: "rejection",
        filename: "Rejection_Detector.mq5",
        name: "Rejection",
        description:
          "Reactive SNR Rule 2 — a candle whose wick pierces an S/R level but " +
          "closes back on the origin side, confirming the level held. Embeds both " +
          "Classic (reversal-pair) and Gap (continuation-pair) level detection.",
        rules: [
          "Levels: Classic (Bull→Bear = Resistance, Bear→Bull = Support) + Gap (same-dir pair)",
          "Bullish rejection: Low <= support AND Close > support AND lower wick >= InpMinWickRatio x range",
          "Bearish rejection: High >= resistance AND Close < resistance AND upper wick >= InpMinWickRatio x range",
          "Level broken when a candle closes through it (removed from tracking)",
          "Levels expire after InpExpiryBars bars (0 = never)",
        ],
        output: [
          "Up/down arrow (codes 233/234) at the rejection candle wick",
          "Label 'REJ UP' / 'REJ DN' at the rejection",
          "Journal: REJECTION_BULL | REJECTION_BEAR | level | price | time",
          "Inputs: min_wick_ratio · use_classic · use_gap · expiry_bars · colors",
        ],
        status: "ready",
        generate: generateRejectionDetector,
      },
      {
        id: "miss",
        filename: "Miss_Detector.mq5",
        name: "Miss",
        description:
          "Reactive SNR (Slide 27) — a swing turning point lands NEAR an S/R " +
          "level without touching it. Price respected the level (it serves as " +
          "liquidity). Embeds Classic + Gap level detection, with the two-candle " +
          "SNR guard so the formation itself is never counted as a miss.",
        rules: [
          "Levels: Classic (Bull→Bear = Res, Bear→Bull = Sup) + Gap (same-dir pair); valid only AFTER Candle B",
          "Pivot: swing high/low confirmed by InpSwingLen bars each side",
          "Bullish miss: swing LOW stays ABOVE support, within InpNearPoints, without touching",
          "Bearish miss: swing HIGH stays BELOW resistance, within InpNearPoints, without touching",
          "Levels expire after InpExpiryBars bars (0 = never)",
        ],
        output: [
          "Dotted level line from the SNR origin to the miss pivot",
          "'Miss' label on the swing turning point",
          "Journal: MISS_BULL | MISS_BEAR | level | pivot | time",
          "Inputs: swing_len · near_points · use_classic · use_gap · expiry_bars · colors",
        ],
        status: "ready",
        generate: generateMissDetector,
      },
      {
        id: "rss-srr",
        filename: "RSS_SRR_Detector.mq5",
        name: "RSS / SRR Detector",
        description:
          "RSS (Resistance Sweeps Supports): a specific Classic Resistance R pushes price " +
          "down to close-break at least 2 Classic Support levels that sit below R. " +
          "SRR (Support Rallies Resistances): a specific Classic Support S rallies price " +
          "up to close-break at least 2 Classic Resistance levels that sit above S. " +
          "Each R/S owns its sweep counter and fires exactly once. " +
          "The driving level line is drawn as the entry reference.",
        rules: [
          "Classic SNR only — Bull→Bear pair = Resistance, Bear→Bull pair = Support (A close = level)",
          "A level is BROKEN when a candle CLOSES through it (wick break does NOT count)",
          "Each resistance R owns a sweep counter — increments each time a support below R is close-broken",
          "RSS fires for R when R's sweep counter reaches InpMinBreaks (default 2)",
          "Mirror: each support S fires SRR when InpMinBreaks resistances above S are broken",
          "R/S fires exactly once (swept flag set) — no duplicate signals for the same level",
          "Two-candle SNR guard: level not valid until after Candle B closes",
        ],
        output: [
          "Solid horizontal line at the driving R (RSS) or S (SRR) — this is the entry reference",
          "Dotted dashes at each swept support/resistance price at the signal bar",
          "'RSS' label below the signal bar | 'SRR' label above",
          "Journal: RSS/SRR | R or S level | swept count | time",
          "Inputs: min_breaks · expiry_bars · colors · ext_bars",
        ],
        status: "ready",
        generate: generateRssSrrDetector,
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
    ],
  },

  // ── 3. Phase 2 State Modules ─────────────────────────────────────────────
  {
    id: "phase2-state",
    label: "State",
    fullName: "Phase 2: State Modules",
    icon: Layers,
    phaseTag: "Phase 2 Active",
    phaseActive: true,
    description:
      "Phase 2 consumes Phase 1 detection output and manages full zone lifecycles. " +
      "Each State Module embeds its own detection, tracks every state transition, " +
      "and exposes indicator buffers for Phase 3 execution modules to consume.",
    modules: [
      {
        id: "fvg-state",
        filename: "FVG_State_Module.mq5",
        name: "FVG State Module",
        description:
          "Embeds FVG detection and manages the complete zone lifecycle. Each zone " +
          "moves through ACTIVE → RETESTED → CONFIRMED, or terminates via MITIGATED / " +
          "INVALIDATED / EXPIRED. Phase 3 can read confirmed-signal bars via indicator buffers.",
        rules: [
          "Bullish FVG: C3.Low > C1.High → UL = C3.Low, LL = C1.High",
          "Bearish FVG: C3.High < C1.Low → UL = C1.Low, LL = C3.High",
          "RETESTED: wick enters zone — Bull: Low ≤ UL  |  Bear: High ≥ LL",
          "CONFIRMED: from RETESTED, close back outside — Bull: Close > UL  |  Bear: Close < LL",
          "MITIGATED: close trades inside zone  LL ≤ Close ≤ UL  [terminal]",
          "INVALIDATED: close beyond far edge — Bull: Close < LL  |  Bear: Close > UL  [terminal]",
          "EXPIRED: barsAlive ≥ InpExpiryBars (default 100)  [terminal]",
          "State cycle: ACTIVE → RETESTED → CONFIRMED → re-RETESTED → … until terminal",
        ],
        output: [
          "OBJ_RECTANGLE per zone — left=C1 time, right=FAR_FUTURE (live) or endTime (terminal)",
          "ACTIVE: solid width 1  |  CONFIRMED: solid width 2  |  RETESTED: gold  |  Terminal: dashed/faded",
          "Labels: FVG↑/↓ (ACTIVE) · FVG-T (RETESTED) · FVG-C (CONFIRMED) · FVG-M / FVG-X / FVG-E",
          "Buffer 0: BullConfirmBuf[sh]=1.0 at bar where bull FVG confirmed (Phase 3 readable via iCustom)",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at bar where bear FVG confirmed",
          "Buffer 2: BullSLBuf[sh]=retestLow at confirmation bar — SL for Phase 3 bull entries",
          "Buffer 3: BearSLBuf[sh]=retestHigh at confirmation bar — SL for Phase 3 bear entries",
          "Journal: FVG_ACTIVE | FVG_RETESTED | FVG_CONFIRMED | FVG_MITIGATED | FVG_INVALIDATED | FVG_EXPIRED",
        ],
        status: "ready",
        generate: generateFvgStateModule,
      },
      {
        id: "ob-state",
        filename: "OB_State_Module.mq5",
        name: "Order Block State Module",
        description:
          "Embeds OB detection (ATR-displacement) and manages full zone lifecycle. " +
          "Same 4-buffer contract as FVG State Module — drop-in for any Phase 3 " +
          "execution module or MTF orchestrator step.",
        rules: [
          "Bullish OB: last BEARISH candle before a bullish displacement (body ≥ InpDispMult × ATR)",
          "Bearish OB: last BULLISH candle before a bearish displacement",
          "RETESTED: wick enters zone — Bull: Low ≤ OB high  |  Bear: High ≥ OB low",
          "CONFIRMED: from RETESTED, close exits near edge — Bull: Close > OB high  |  Bear: Close < OB low",
          "MITIGATED: close inside zone  OB low ≤ Close ≤ OB high  [terminal]",
          "INVALIDATED: close beyond far edge — Bull: Close < OB low  |  Bear: Close > OB high  [terminal]",
          "EXPIRED: barsAlive ≥ InpExpiryBars (default 100)  [terminal]",
          "State cycle: ACTIVE → RETESTED → CONFIRMED → re-RETESTED → … until terminal",
        ],
        output: [
          "OBJ_RECTANGLE per zone — left=OB candle time, right=FAR_FUTURE (live) or endTime (terminal)",
          "ACTIVE: solid width 1  |  CONFIRMED: solid width 2  |  RETESTED: gold  |  Terminal: dashed/faded",
          "Labels: OB↑/↓ (ACTIVE) · OB-T (RETESTED) · OB-C (CONFIRMED) · OB-M / OB-X / OB-E",
          "Buffer 0: BullConfirmBuf[sh]=1.0 at bar where bull OB confirmed",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at bar where bear OB confirmed",
          "Buffer 2: BullSLBuf[sh]=retestLow at confirmation bar — SL for bull entries",
          "Buffer 3: BearSLBuf[sh]=retestHigh at confirmation bar — SL for bear entries",
          "Journal: OB_ACTIVE | OB_RETESTED | OB_CONFIRMED | OB_MITIGATED | OB_INVALIDATED | OB_EXPIRED",
        ],
        status: "ready",
        generate: generateObStateModule,
      },
      {
        id: "breakout-state",
        filename: "Breakout_State_Module.mq5",
        name: "Breakout State Module",
        description:
          "Embeds Classic SNR detection + breakout logic and manages the full RBS/SBR " +
          "lifecycle. A broken SNR level flips to FLIP state (first bar holds), then " +
          "tracks RETESTED → CONFIRMED when a wick returns and close holds. Same 4-buffer " +
          "contract as all Phase 2 modules — drop-in for MTF orchestrator steps.",
        rules: [
          "Embeds Classic SNR: Bull→Bear pair = Resistance, Bear→Bull pair = Support (A close = level)",
          "ACTIVE: close breaks through SNR level — confirmed breakout bar",
          "FLIP: first bar after breakout where price does NOT close back through — RBS/SBR live",
          "RETESTED: from FLIP, wick returns to level without closing through",
          "CONFIRMED: from RETESTED, close holds on correct side → Phase 3 signal fired",
          "INVALIDATED: close back through the level at any FLIP/RETESTED/CONFIRMED stage [terminal]",
          "EXPIRED: barsAlive ≥ InpExpiryBars (default 100) [terminal]",
          "Filters: body size, break-distance, optional ATR multiplier",
        ],
        output: [
          "OBJ_TREND line per zone — from breakoutTime, RAY_RIGHT while live",
          "ACTIVE: width 1 (bull/bear color)  |  FLIP: width 2 (RBS green / SBR orange-red)",
          "RETESTED: clrGold  |  CONFIRMED: width 2 confirm color  |  Terminal: dashed/faded",
          "Labels: BO↑/↓ (ACTIVE) · RBS/SBR (FLIP) · RBS-T/SBR-T (RETESTED) · RBS-C/SBR-C · RBS-X/SBR-X",
          "Buffer 0: BullConfirmBuf[sh]=1.0 at bar where RBS confirmed (Phase 3 readable via iCustom)",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at bar where SBR confirmed",
          "Buffer 2: BullSLBuf[sh]=retestLow at RBS confirmation bar — SL for bull entries",
          "Buffer 3: BearSLBuf[sh]=retestHigh at SBR confirmation bar — SL for bear entries",
          "Journal: RBS_ACTIVE | SBR_ACTIVE | RBS_RETESTED | SBR_RETESTED | RBS_CONFIRMED | SBR_CONFIRMED | RBS_INVALIDATED | SBR_INVALIDATED | BREAKOUT_ACTIVE | BREAKOUT_EXPIRED",
        ],
        status: "ready",
        generate: generateBreakoutStateModule,
      },
      {
        id: "rejection-state",
        filename: "Rejection_State_Module.mq5",
        name: "Rejection State Module",
        description:
          "Embeds Classic + Gap S/R level detection and fires a CONFIRMED signal when a " +
          "candle's wick pierces a level but the close holds on the origin side (rejection). " +
          "Same two-candle SNR guard as the Rejection Detector. Exposes 4 iCustom buffers " +
          "so Phase 3 EAs can read bull/bear confirm events and their SL levels.",
        rules: [
          "Levels: Classic (Bull→Bear = Res, Bear→Bull = Sup) + Gap (same-dir pair); valid only AFTER Candle B",
          "Bullish rejection: Low <= support AND Close > support AND lower wick >= InpMinWickRatio x range",
          "Bearish rejection: High >= resistance AND Close < resistance AND upper wick >= InpMinWickRatio x range",
          "Level broken when a candle closes through it (removed from tracking)",
          "Levels expire after InpExpiryBars bars (0 = never)",
        ],
        output: [
          "Buffer 0: BullConfirmBuf[sh]=1.0 at a bullish rejection bar (wick through support, close holds)",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at a bearish rejection bar (wick through resistance, close holds)",
          "Buffer 2: BullSLBuf[sh]=rejection wick low — SL for bull entries",
          "Buffer 3: BearSLBuf[sh]=rejection wick high — SL for bear entries",
          "OBJ_TREND solid level line from SNR origin to rejection candle + TF label (DRD/WRW/4R4/1R1/MRM/Rej)",
          "Journal: REJECTION_BULL | REJECTION_BEAR | label | level | sl | time",
          "Inputs: min_wick_ratio · use_classic · use_gap · expiry_bars · draw · line_bars · colors",
        ],
        status: "ready",
        generate: generateRejectionStateModule,
      },
      {
        id: "miss-state",
        filename: "Miss_State_Module.mq5",
        name: "Miss State Module",
        description:
          "Embeds Classic + Gap S/R level detection and fires a signal when any candle " +
          "comes within proximity of a level without its wick touching it. The candle with " +
          "the MINIMUM wick distance to the level gets the signal — buffers update in-place " +
          "if a closer candle appears. Any wick touch retires the level and clears buffers. " +
          "Proximity threshold auto-scales to any instrument via ATR fraction.",
        rules: [
          "Levels: Classic (Bull→Bear = Res, Bear→Bull = Sup) + Gap (same-dir pair); valid only AFTER Candle B",
          "Every closed candle is evaluated — no swing-pivot requirement",
          "Bullish miss: wick Low above support AND (Low - level) <= InpNearATR × ATR(14)",
          "Bearish miss: wick High below resistance AND (level - High) <= InpNearATR × ATR(14)",
          "Any wick TOUCH (Low <= support OR High >= resistance) kills the level — no miss possible",
          "When a closer approach is found, old buffer entries are cleared and new ones written",
          "Levels expire after InpExpiryBars bars (0 = never)",
        ],
        output: [
          "Buffer 0: BullConfirmBuf[sh]=1.0 at the closest bullish miss bar (wick stops above support)",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at the closest bearish miss bar (wick stops below resistance)",
          "Buffer 2: BullSLBuf[sh]=wick Low of closest miss — SL for bull entries",
          "Buffer 3: BearSLBuf[sh]=wick High of closest miss — SL for bear entries",
          "'Ms' text label on the closest miss candle (updates if a closer bar appears)",
          "Journal: MISS_BULL | MISS_BEAR | level | wick | dist pts | time",
          "Inputs: InpNearATR (default 0.20) · InpATRPeriod (14) · InpNearPoints override · use_classic · use_gap · expiry_bars",
        ],
        status: "ready",
        generate: generateMissStateModule,
      },
      {
        id: "zone-liq-state",
        filename: "Zone_Liq_State_Module.mq5",
        name: "Zone Liquidity Setup State Module",
        description:
          "Phase 2 state module for unified FVG + OB + BB liquidity setups. Tracks the " +
          "full lifecycle: zone detect → liquidity build → tap → reject → entry signal. " +
          "Same 4-buffer contract as FVG/OB state modules for Phase 3 EAs.",
        rules: [
          "Zone types: FVG (3-candle gap), OB (displacement), BB (OB closed through → polarity flip)",
          "Liquidity: bar closes within proximity without wick entering the zone",
          "Tap: wick enters zone after min liquidity bars",
          "Reject: close back outside zone — bull close > top, bear close < bottom",
          "Signal buffers fire on the entry bar (next open after rejection)",
        ],
        output: [
          "Buffer 0: BullConfirmBuf — buy entry bar arrow price",
          "Buffer 1: BearConfirmBuf — sell entry bar",
          "Buffer 2/3: BullSLBuf / BearSLBuf — SL beyond zone + buffer",
          "Filled zone rectangles + gold SL line on rejection",
          "Journal: ZLS BUY/SELL | kind | tap+reject | SL | entry next open",
        ],
        status: "ready",
        generate: generateZoneLiqStateModule,
        catalogKind: "state_module",
      },
      {
        id: "rss-srr-state",
        filename: "RSS_SRR_State_Module.mq5",
        name: "RSS / SRR State Module",
        description:
          "Same sweep detection as the RSS/SRR Detector. Each Classic Resistance R owns " +
          "a sweep counter — RSS fires for R when InpMinBreaks supports below R are " +
          "close-broken. Mirror for SRR on each support S. SL buffers carry the driving " +
          "level price so Phase 3 EAs know exactly where to put the stop.",
        rules: [
          "Classic SNR only — Bull→Bear = Resistance, Bear→Bull = Support (A close = level)",
          "Each R/S owns a sweep counter that increments on every opposite-side close-break in the correct direction",
          "RSS fires for R when sweepCount >= InpMinBreaks (supports below R broken)",
          "SRR fires for S when sweepCount >= InpMinBreaks (resistances above S broken)",
          "Each level fires exactly once (swept flag) — no duplicate signals",
          "Two-candle SNR guard; levels expire after InpExpiryBars bars",
        ],
        output: [
          "Buffer 0: SRRBuf[sh]=1.0 at SRR signal bar (S drove 2+ resistance breaks above it)",
          "Buffer 1: RSSBuf[sh]=1.0 at RSS signal bar (R drove 2+ support breaks below it)",
          "Buffer 2: SRRSLBuf[sh]=driving Support wick low — SL for buy entries (close below = setup invalid)",
          "Buffer 3: RSSSLBuf[sh]=driving Resistance wick high — SL for sell entries (close above = setup invalid)",
          "Buffers cleared if price later closes beyond the driving level wick extreme",
          "Visual: same as RSS/SRR Detector — R/S line + Possible Sell/Buy + swept S/R labels",
          "Journal: RSS | R=X | wick=X | swept=N | time  /  SRR | S=X | wick=X | swept=N | time",
          "Inputs: min_breaks · expiry_bars · draw · colors · ext_bars",
        ],
        status: "ready",
        generate: generateRssSrrStateModule,
      },
      {
        id: "rsi-hd-state",
        filename: "RSI_Hidden_Divergence_State_Module.mq5",
        name: "RSI Hidden Divergence State Module",
        description:
          "Phase 2 state machine for RSI Hidden Divergence (trend-continuation SETUP). " +
          "Detects the divergence then tracks ACTIVE → CONFIRMED → INVALIDATED / EXPIRED, " +
          "exposing the standard 4-buffer iCustom contract for the Setup Brain / Phase 3 EAs.",
        rules: [
          "Bullish HD: price HL + RSI LL; Bearish HD: price LH + RSI HH",
          "ACTIVE: divergence detected on the second confirmed pivot",
          "CONFIRMED: price closes beyond the swing between the two swings (above intervening high for bull)",
          "INVALIDATED: price closes beyond the second swing (below 2nd low for bull / above 2nd high for bear)",
          "EXPIRED: InpExpiryBars pass with no confirmation",
        ],
        output: [
          "Buffer 0: BullConfirmBuf[sh]=1.0 at bullish HD confirmation",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at bearish HD confirmation",
          "Buffer 2: BullSLBuf[sh]=second swing low — SL for bull continuation",
          "Buffer 3: BearSLBuf[sh]=second swing high — SL for bear continuation",
          "Journal: RSI_HD_*_ACTIVE | _CONFIRMED | _INVALID | sl | time",
          "Inputs: rsi_period · pivot_left/right · min_bars · max_bars · expiry_bars",
        ],
        status: "ready",
        generate: generateRsiHiddenDivergenceStateModule,
      },
      {
        id: "choch-state",
        filename: "CHoCH_State_Module.mq5",
        name: "CHoCH State Module",
        description:
          "Structural reversal module — embeds swing pivot detection and fires only on " +
          "counter-trend structure breaks. In a BEAR trend, a close above a swing high " +
          "is a Bull CHoCH (potential reversal). In a BULL trend, a close below a swing " +
          "low is a Bear CHoCH. BOS-style persistent trend buffers + CHoCH event buffers. " +
          "Dashed lines visually distinguish CHoCH from BOS (which uses solid lines).",
        rules: [
          "Swing High / Low confirmed after InpSwingLeft + InpSwingRight bars",
          "Bull CHoCH: close > unconsumed swing HIGH while trend is BEAR or UNKNOWN",
          "Bear CHoCH: close < unconsumed swing LOW while trend is BULL or UNKNOWN",
          "With-trend breaks (continuation): swing consumed silently, no CHoCH signal",
          "UNKNOWN trend: first break in either direction creates CHoCH + sets gTrend",
          "gTrend flips on every CHoCH event (BEAR→BULL or BULL→BEAR)",
          "Each swing consumed once regardless of whether CHoCH or BOS",
          "InpMaxLines=20 — oldest dashed line removed when limit exceeded",
        ],
        output: [
          "OBJ_TREND STYLE_DASH horizontal ray per CHoCH — from swingTime, RAY_RIGHT=1",
          "Bull CHoCH: clrDodgerBlue  |  Bear CHoCH: clrDarkOrange",
          "Optional OBJ_TEXT label: 'CHoCH ↑' / 'CHoCH ↓' at the CHoCH bar",
          "Buffer 0: BullTrendBuf[sh]=1.0 on every bar while CHoCH-based trend is BULL",
          "Buffer 1: BearTrendBuf[sh]=1.0 on every bar while CHoCH-based trend is BEAR",
          "Buffer 2: ChochUpBuf[sh]=1.0 at bar where bull CHoCH fired (event)",
          "Buffer 3: ChochDnBuf[sh]=1.0 at bar where bear CHoCH fired (event)",
          "Journal: CHOCH_BULL | CHOCH_BEAR | id | level | time",
        ],
        status: "ready",
        generate: generateChochStateModule,
      },
      {
        id: "bos-state",
        filename: "BOS_State_Module.mq5",
        name: "BOS State Module",
        description:
          "Structural bias module — embeds swing pivot detection and Break-of-Structure " +
          "logic. Tracks trend state (BULL / BEAR / UNKNOWN) and exposes both persistent " +
          "trend buffers (read any bar) and event buffers (fire once at the BOS bar). " +
          "Used as a bias filter in MTF strategies: step confirms immediately when trend " +
          "is active, rather than waiting for a zone retest.",
        rules: [
          "Swing High: high > InpSwingLeft left bars AND > InpSwingRight right bars",
          "Swing Low:  low  < InpSwingLeft left bars AND < InpSwingRight right bars",
          "Bull BOS: candle CLOSE > unconsumed swing high → gTrend = BULL",
          "Bear BOS: candle CLOSE < unconsumed swing low  → gTrend = BEAR",
          "Each swing can generate exactly one BOS (consumed flag prevents repeats)",
          "Trend persists until next BOS event — no invalidation / auto-reversal",
          "BOS lines drawn as horizontal rays from swing candle → FAR_FUTURE",
          "Max lines: InpMaxLines=20 — oldest line removed when limit exceeded",
        ],
        output: [
          "OBJ_TREND horizontal ray per BOS — from swingTime, RAY_RIGHT=1",
          "Bull BOS: clrMediumSeaGreen  |  Bear BOS: clrTomato",
          "Optional OBJ_TEXT label at BOS bar: 'Bull BOS' / 'Bear BOS'",
          "Buffer 0: BullTrendBuf[sh]=1.0 on every bar while trend is BULL (persistent)",
          "Buffer 1: BearTrendBuf[sh]=1.0 on every bar while trend is BEAR (persistent)",
          "Buffer 2: BosUpBuf[sh]=1.0 at the specific bar where bull BOS fired (event)",
          "Buffer 3: BosDnBuf[sh]=1.0 at the specific bar where bear BOS fired (event)",
          "Journal: BOS_BULL | BOS_BEAR | id | level | bosTime",
        ],
        status: "ready",
        generate: generateBosStateModule,
      },
      {
        id: "bb-state",
        filename: "BB_State_Module.mq5",
        name: "Breaker Block State Module",
        description:
          "Two-layer detection: embeds OB detection (ATR displacement) and checks when " +
          "an OB is broken in the opposite direction — creating a Breaker Block zone. " +
          "The BB then tracks ACTIVE → RETESTED → CONFIRMED with identical lifecycle to " +
          "OB State. Same 4-buffer contract — drop-in for any Phase 3 or MTF step.",
        rules: [
          "OB Detection: ATR body ≥ InpDispMult × ATR14 → walk back up to InpObLookback bars for last opposing candle",
          "Bullish OB (last bearish before bull disp.) broken when close < OB lo → Bearish BB",
          "Bearish OB (last bullish before bear disp.) broken when close > OB hi → Bullish BB",
          "BB ACTIVE: breakout confirmed — zone now flipped polarity",
          "RETESTED: wick enters zone — Bull BB: Low ≤ OB hi  |  Bear BB: High ≥ OB lo",
          "CONFIRMED: from RETESTED, close exits near edge — Bull: Close > OB hi  |  Bear: Close < OB lo",
          "MITIGATED: close inside zone  OB lo ≤ Close ≤ OB hi  [terminal]",
          "INVALIDATED: close beyond far edge [terminal]  |  EXPIRED: barsAlive ≥ InpExpiryBars [terminal]",
        ],
        output: [
          "OBJ_RECTANGLE per zone — left=OB candle time, right=FAR_FUTURE (live) or endTime (terminal)",
          "ACTIVE: solid width 1  |  CONFIRMED: solid width 2  |  RETESTED: gold  |  Terminal: dashed/faded",
          "Labels: BB↑/↓ (ACTIVE) · BB-T (RETESTED) · BB-C (CONFIRMED) · BB-M / BB-X / BB-E",
          "Buffer 0: BullConfirmBuf[sh]=1.0 at bar where bull BB confirmed",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at bar where bear BB confirmed",
          "Buffer 2: BullSLBuf[sh]=retestLow at confirmation bar — SL for bull entries",
          "Buffer 3: BearSLBuf[sh]=retestHigh at confirmation bar — SL for bear entries",
          "Journal: BB_BULL_ACTIVE | BB_BEAR_ACTIVE | BB_BULL_RETESTED | BB_BULL_CONFIRMED | BB_BEAR_CONFIRMED | BB_BULL_MITIGATED | BB_BEAR_INVALIDATED | BB_BULL_EXPIRED",
        ],
        status: "ready",
        generate: generateBbStateModule,
      },
      {
        id: "fvg-inversion-state",
        filename: "FVG_Inversion_State_Module.mq5",
        name: "FVG Inversion State Module",
        description:
          "Two-layer detection: embeds FVG detection and checks when an FVG is closed " +
          "through on its far side — flipping polarity. The Inversion FVG then tracks " +
          "ACTIVE → RETESTED → CONFIRMED with identical state logic to FVG State Module. " +
          "Distinct object prefix (SMCIFVGS_) and colours prevent collision.",
        rules: [
          "Bullish FVG: C3.Low > C1.High → UL=C3.Low, LL=C1.High",
          "Bearish FVG: C3.High < C1.Low → UL=C1.Low, LL=C3.High",
          "Bullish FVG inverted when close < LL → Bearish IFVG (resistance zone)",
          "Bearish FVG inverted when close > UL → Bullish IFVG (support zone)",
          "Bull IFVG RETESTED: barLow ≤ UL  |  CONFIRMED: barClose > UL from RETESTED",
          "Bear IFVG RETESTED: barHigh ≥ LL  |  CONFIRMED: barClose < LL from RETESTED",
          "MITIGATED: close inside zone  LL ≤ Close ≤ UL  [terminal]",
          "INVALIDATED: close beyond far edge  |  EXPIRED: barsAlive ≥ InpExpiryBars",
        ],
        output: [
          "OBJ_RECTANGLE per zone — left=FVG C1 time, right=FAR_FUTURE (live) or endTime",
          "Bull: clrMediumAquamarine  |  Bear: clrOrchid  |  RETESTED: gold  |  Terminal: dotted/faded",
          "Labels: IFVG↑/↓ · IFVG-T · IFVG-C · IFVG-M · IFVG-X · IFVG-E",
          "Buffer 0: BullConfirmBuf[sh]=1.0 at bull IFVG CONFIRMED bar",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at bear IFVG CONFIRMED bar",
          "Buffer 2: BullSLBuf[sh]=retestLow at confirmation bar",
          "Buffer 3: BearSLBuf[sh]=retestHigh at confirmation bar",
          "Journal: IFVG_BULL_ACTIVE | IFVG_BEAR_ACTIVE | IFVG_BULL_RETESTED | IFVG_BULL_CONFIRMED | IFVG_BEAR_CONFIRMED | IFVG_BULL_MITIGATED | IFVG_BEAR_INVALIDATED | IFVG_BULL_EXPIRED",
        ],
        status: "ready",
        generate: generateFvgInversionStateModule,
      },
      {
        id: "liqsweep-state",
        filename: "LiqSweep_State_Module.mq5",
        name: "Liquidity Sweep State Module",
        description:
          "Embeds swing pivot detection and tracks the full sweep lifecycle. Unlike " +
          "FVG/OB state modules (which wait for a retest), the sweep confirmation IS " +
          "the signal: wick pierces a swing level (PENDING), then closes back on the " +
          "correct side (CONFIRMED → Phase 3 signal). EXPIRED if close-back doesn't " +
          "arrive within InpMaxWaitBars. Same 4-buffer contract as all Phase 2 modules.",
        rules: [
          "Swing High / Low confirmed after InpSwingStr bars each side (default 3)",
          "Bull sweep: barLow < swing low AND (same-bar OR next N bars) close > swing low",
          "Bear sweep: barHigh > swing high AND close < swing high",
          "PENDING: wick detected, close-back not yet confirmed",
          "CONFIRMED: close-back on correct side within InpMaxWaitBars (default 5)",
          "EXPIRED: InpMaxWaitBars exceeded without close-back — or InpExpiryBars total age",
          "Same-bar confirmation supported: wick + close-back on same candle → immediate CONFIRMED",
          "Each swing consumed once — single sweep per pivot",
        ],
        output: [
          "OBJ_TREND dashed line at swing level — swingTime → confirmTime (or FAR_FUTURE if pending)",
          "PENDING: faded dashed line  |  CONFIRMED: full-opacity solid+1 line  |  EXPIRED: dotted",
          "Optional OBJ_TEXT label: Sweep↑/↓ (PENDING) · Sweep↑-C/↓-C (CONFIRMED) · Sweep↑-E/↓-E",
          "Buffer 0: BullConfirmBuf[sh]=1.0 at bull sweep CONFIRMED bar",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at bear sweep CONFIRMED bar",
          "Buffer 2: BullSLBuf[sh]=sweepLow — wick low of sweep bar (SL for bull entries)",
          "Buffer 3: BearSLBuf[sh]=sweepHigh — wick high of sweep bar (SL for bear entries)",
          "Journal: LIQSWEEP_BULL_PENDING | LIQSWEEP_BULL_CONFIRMED | LIQSWEEP_BULL_EXPIRED (and BEAR variants)",
        ],
        status: "ready",
        generate: generateLiqSweepStateModule,
      },
      {
        id: "classic-snr-state",
        filename: "Classic_SNR_State_Module.mq5",
        name: "Classic SNR State Module",
        description:
          "Embeds Classic SNR detection (candle-pair direction REVERSAL) and tracks each " +
          "level through ACTIVE → RETESTED → CONFIRMED. A wick touching the level triggers " +
          "RETESTED; a close-back on the correct side triggers CONFIRMED (Phase 3 signal). " +
          "Cycles until BROKEN (close through) or EXPIRED.",
        rules: [
          "RESISTANCE: Bullish A → Bearish B  →  A.close = resistance level",
          "SUPPORT:    Bearish A → Bullish B  →  A.close = support level",
          "Optional doji filter: skip candles with body ≤ InpDojiThresh × range",
          "RETESTED: wick reaches level — Support: barLow ≤ level  |  Resistance: barHigh ≥ level",
          "CONFIRMED: from RETESTED, close holds — Support: close > level  |  Resistance: close < level",
          "BROKEN: close on wrong side [terminal]  |  EXPIRED: barsAlive ≥ InpExpiryBars [terminal]",
          "Post-CONFIRMED: cycles back RETESTED → CONFIRMED on each new touch until terminal",
        ],
        output: [
          "OBJ_TREND horizontal line per level — levelTime to FAR_FUTURE (live) or endTime (terminal)",
          "ACTIVE: faded solid  |  RETESTED: gold  |  CONFIRMED: full-color width+1  |  Terminal: dotted",
          "Labels: C-Sup / C-Res (ACTIVE) · C-Sup-T / C-Res-T (RETESTED) · C-Sup-C / C-Res-C (CONFIRMED) · -B / -E",
          "Buffer 0: BullConfirmBuf[sh]=1.0 at support CONFIRMED bar",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at resistance CONFIRMED bar",
          "Buffer 2: BullSLBuf[sh]=retestLow at confirmation bar — wick low of retest (SL for bulls)",
          "Buffer 3: BearSLBuf[sh]=retestHigh at confirmation bar — wick high of retest (SL for bears)",
          "Journal: C_SNR_SUPPORT_CONFIRMED | C_SNR_RESISTANCE_CONFIRMED | id | level | sl | sh",
        ],
        status: "ready",
        generate: generateClassicSnrStateModule,
      },
      {
        id: "gap-snr-state",
        filename: "Gap_SNR_State_Module.mq5",
        name: "Gap SNR State Module",
        description:
          "Identical lifecycle to Classic SNR State — only detection differs. Gap SNR " +
          "uses candle-pair direction CONTINUATION (Bull→Bull = Support, Bear→Bear = " +
          "Resistance). Distinct object prefix (SMCSNRGS_) and colours prevent collision " +
          "when both modules run on the same chart.",
        rules: [
          "GAP SUPPORT:    Bullish A → Bullish B  →  A.close = support level",
          "GAP RESISTANCE: Bearish A → Bearish B  →  A.close = resistance level",
          "Optional doji filter: skip candles with body ≤ InpDojiThresh × range",
          "RETESTED: wick reaches level — Support: barLow ≤ level  |  Resistance: barHigh ≥ level",
          "CONFIRMED: from RETESTED, close holds — Support: close > level  |  Resistance: close < level",
          "BROKEN: close on wrong side [terminal]  |  EXPIRED: barsAlive ≥ InpExpiryBars [terminal]",
          "Post-CONFIRMED: cycles back RETESTED → CONFIRMED on each new touch until terminal",
        ],
        output: [
          "OBJ_TREND horizontal line per level — levelTime to FAR_FUTURE or endTime",
          "ACTIVE: faded solid  |  RETESTED: gold  |  CONFIRMED: full-color width+1  |  Terminal: dotted",
          "Labels: G-Sup / G-Res · G-Sup-T / G-Res-T · G-Sup-C / G-Res-C · -B / -E",
          "Buffer 0: BullConfirmBuf[sh]=1.0 at gap support CONFIRMED bar",
          "Buffer 1: BearConfirmBuf[sh]=1.0 at gap resistance CONFIRMED bar",
          "Buffer 2: BullSLBuf[sh]=retestLow at confirmation bar",
          "Buffer 3: BearSLBuf[sh]=retestHigh at confirmation bar",
          "Journal: G_SNR_SUPPORT_CONFIRMED | G_SNR_RESISTANCE_CONFIRMED | id | level | sl | sh",
        ],
        status: "ready",
        generate: generateGapSnrStateModule,
      },
    ],
  },

  // ── 4. Phase 3 Execution Modules ─────────────────────────────────────────
  {
    id: "phase3-exec",
    label: "Execution",
    fullName: "Phase 3: Execution Modules",
    icon: Zap,
    phaseTag: "Phase 3 Active",
    phaseActive: true,
    description:
      "Phase 3 Expert Advisors consume Phase 2 State Module buffers via iCustom() " +
      "and place real trades. Each EA reads confirmed-signal bars, validates SL from " +
      "the state module, applies risk management, and manages open positions.",
    modules: [
      {
        id: "fvg-exec",
        filename: "FVG_Execution_EA.mq5",
        name: "FVG Execution EA",
        description:
          "Expert Advisor that consumes FVG_State_Module.mq5 via iCustom(). " +
          "Enters on the bar open after BullConfirmBuf[1]==1.0 (BUY) or " +
          "BearConfirmBuf[1]==1.0 (SELL). SL comes from BullSLBuf / BearSLBuf — " +
          "trade is blocked if SL buffer is zero or on the wrong side. " +
          "Fixed RR TP, breakeven at 0.5R, spread filter, max-open-trades guard. " +
          "Place in MQL5/Experts/ folder.",
        rules: [
          "BUY signal:  BullConfirmBuf[1]==1.0 AND BullSLBuf[1]>0 AND sl < entry",
          "SELL signal: BearConfirmBuf[1]==1.0 AND BearSLBuf[1]>0 AND sl > entry",
          "Entry: new-bar open (one signal check per candle close)",
          "TP: entry ± slDist × InpRR  (default RR = 2.0)",
          "Lot size: (balance × InpRiskPct%) / (slDist × tickValue/tickSize)",
          "Spread filter: current spread > InpMaxSpreadPts → SIGNAL_BLOCKED",
          "Max trades: CountMyPositions() ≥ InpMaxTrades → SIGNAL_BLOCKED",
          "Breakeven: every tick — if floating profit ≥ InpBreakevenR × initialRisk, move SL to entry",
        ],
        output: [
          "Journal: TRADE_OPENED | dir | entry | sl | tp | lots | risk",
          "Journal: TRADE_FAILED | dir | retcode | entry | sl",
          "Journal: BREAKEVEN_SET | ticket | dir | entry | profit_at_trigger",
          "Journal: SIGNAL_BLOCKED | reason (spread / max_trades / sl_invalid / zero_lots / sl_too_close)",
          "Inputs: module_name · module_tf · magic · risk_pct · rr · breakeven_r · max_trades · max_spread_pts",
          "Reads: iCustom() buffers 0–3 from FVG_State_Module (BullConfirm / BearConfirm / BullSL / BearSL)",
        ],
        status: "ready",
        generate: generateFvgExecutionEa,
      },
      {
        id: "ob-exec",
        filename: "OB_Execution_EA.mq5",
        name: "Order Block Execution EA",
        description:
          "Expert Advisor that consumes OB_State_Module.mq5 via iCustom(). " +
          "Enters on the bar open after an OB CONFIRMED signal fires. SL from " +
          "BullSLBuf / BearSLBuf. Fixed RR TP, breakeven at 0.5R, spread filter, " +
          "max-open-trades guard. Place in MQL5/Experts/ folder.",
        rules: [
          "BUY signal:  BullConfirmBuf[1]==1.0 AND BullSLBuf[1]>0 AND sl < entry",
          "SELL signal: BearConfirmBuf[1]==1.0 AND BearSLBuf[1]>0 AND sl > entry",
          "Entry: new-bar open (one signal check per candle close)",
          "TP: entry ± slDist × InpRR  (default RR = 2.0)",
          "Lot size: (balance × InpRiskPct%) / (slDist × tickValue/tickSize)",
          "Spread filter: current spread > InpMaxSpreadPts → SIGNAL_BLOCKED",
          "Max trades: CountMyPositions() ≥ InpMaxTrades → SIGNAL_BLOCKED",
          "Breakeven: every tick — if floating profit ≥ InpBreakevenR × initialRisk, move SL to entry",
        ],
        output: [
          "Reads iCustom() buffers 0–3 from OB_State_Module (BullConfirm / BearConfirm / BullSL / BearSL)",
          "Journal: TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | SIGNAL_BLOCKED",
          "Inputs: module_name · module_tf · module_lookback · magic · risk_pct · rr · breakeven_r · max_trades · max_spread_pts",
          "Compatible with any Phase 2 state module — change InpModuleName to swap modules",
        ],
        status: "ready",
        generate: () => generatePhase3Ea(OB_EA_CONFIG),
      },
      {
        id: "breakout-exec",
        filename: "Breakout_Execution_EA.mq5",
        name: "Breakout Execution EA",
        description:
          "Expert Advisor that consumes Breakout_State_Module.mq5 via iCustom(). " +
          "Enters on RBS CONFIRMED (BUY) or SBR CONFIRMED (SELL) signals. " +
          "SL from BullSLBuf / BearSLBuf (wick low/high of retest bar).",
        rules: [
          "BUY signal:  BullConfirmBuf[1]==1.0 (RBS CONFIRMED) AND BullSLBuf[1]>0",
          "SELL signal: BearConfirmBuf[1]==1.0 (SBR CONFIRMED) AND BearSLBuf[1]>0",
          "Entry: new-bar open after confirmed breakout retest",
          "TP: entry ± slDist × InpRR  (default RR = 2.0)",
          "Spread filter, max-trades guard, breakeven management identical to FVG EA",
        ],
        output: [
          "Reads iCustom() buffers 0–3 from Breakout_State_Module",
          "Journal: TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | SIGNAL_BLOCKED",
          "Inputs: module_name · module_tf · module_lookback · magic · risk_pct · rr · breakeven_r",
          "Compatible with any Phase 2 state module — change InpModuleName to swap modules",
        ],
        status: "ready",
        generate: () => generatePhase3Ea(BREAKOUT_EA_CONFIG),
      },
      {
        id: "bb-exec",
        filename: "BB_Execution_EA.mq5",
        name: "Breaker Block Execution EA",
        description:
          "Expert Advisor that consumes BB_State_Module.mq5 via iCustom(). " +
          "Enters on BB CONFIRMED signals — an OB that flipped polarity and " +
          "price retested the recycled zone from the new direction.",
        rules: [
          "BUY signal:  BullConfirmBuf[1]==1.0 (Bullish BB CONFIRMED) AND BullSLBuf[1]>0",
          "SELL signal: BearConfirmBuf[1]==1.0 (Bearish BB CONFIRMED) AND BearSLBuf[1]>0",
          "Two-layer detection: OB detected → OB broken (BB created) → BB retested → CONFIRMED",
          "TP: entry ± slDist × InpRR  (default RR = 2.0)",
          "Spread filter, max-trades guard, breakeven management identical to FVG EA",
        ],
        output: [
          "Reads iCustom() buffers 0–3 from BB_State_Module",
          "Journal: TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | SIGNAL_BLOCKED",
          "Inputs: module_name · module_tf · module_lookback · magic · risk_pct · rr · breakeven_r",
          "Compatible with any Phase 2 state module — change InpModuleName to swap modules",
        ],
        status: "ready",
        generate: () => generatePhase3Ea(BB_EA_CONFIG),
      },
      {
        id: "liqsweep-exec",
        filename: "LiqSweep_Execution_EA.mq5",
        name: "Liquidity Sweep Execution EA",
        description:
          "Expert Advisor that consumes LiqSweep_State_Module.mq5 via iCustom(). " +
          "Enters when a sweep CONFIRMATION fires — wick pierced a swing level and " +
          "price closed back on the correct side. SL = wick extreme of the sweep bar.",
        rules: [
          "BUY signal:  BullConfirmBuf[1]==1.0 (Bull Sweep CONFIRMED) AND BullSLBuf[1]>0",
          "SELL signal: BearConfirmBuf[1]==1.0 (Bear Sweep CONFIRMED) AND BearSLBuf[1]>0",
          "SL for bull entries: sweepLow (wick low of sweep bar)",
          "SL for bear entries: sweepHigh (wick high of sweep bar)",
          "TP: entry ± slDist × InpRR  (default RR = 2.0)",
        ],
        output: [
          "Reads iCustom() buffers 0–3 from LiqSweep_State_Module",
          "Journal: TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | SIGNAL_BLOCKED",
          "Inputs: module_name · module_tf · module_lookback · magic · risk_pct · rr · breakeven_r",
          "Compatible with any Phase 2 state module — change InpModuleName to swap modules",
        ],
        status: "ready",
        generate: () => generatePhase3Ea(LIQSWEEP_EA_CONFIG),
      },
      {
        id: "fvg-inversion-exec",
        filename: "FVG_Inversion_Execution_EA.mq5",
        name: "FVG Inversion Execution EA",
        description:
          "Expert Advisor that consumes FVG_Inversion_State_Module.mq5 via iCustom(). " +
          "Enters when an Inversion FVG CONFIRMED signal fires — an FVG that flipped " +
          "polarity and was then retested from the new direction.",
        rules: [
          "BUY signal:  BullConfirmBuf[1]==1.0 (Bullish IFVG CONFIRMED) AND BullSLBuf[1]>0",
          "SELL signal: BearConfirmBuf[1]==1.0 (Bearish IFVG CONFIRMED) AND BearSLBuf[1]>0",
          "Two-layer detection: FVG detected → FVG inverted (IFVG created) → IFVG retested → CONFIRMED",
          "TP: entry ± slDist × InpRR  (default RR = 2.0)",
          "Spread filter, max-trades guard, breakeven management identical to FVG EA",
        ],
        output: [
          "Reads iCustom() buffers 0–3 from FVG_Inversion_State_Module",
          "Journal: TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | SIGNAL_BLOCKED",
          "Inputs: module_name · module_tf · module_lookback · magic · risk_pct · rr · breakeven_r",
          "Compatible with any Phase 2 state module — change InpModuleName to swap modules",
        ],
        status: "ready",
        generate: () => generatePhase3Ea(IFVG_EA_CONFIG),
      },
      {
        id: "classic-snr-exec",
        filename: "Classic_SNR_Execution_EA.mq5",
        name: "Classic SNR Execution EA",
        description:
          "Expert Advisor that consumes Classic_SNR_State_Module.mq5 via iCustom(). " +
          "Enters when a Classic S/R level CONFIRMED signal fires — a wick touched the " +
          "level (RETESTED) then close held on the correct side (CONFIRMED).",
        rules: [
          "BUY signal:  BullConfirmBuf[1]==1.0 (Support CONFIRMED) AND BullSLBuf[1]>0",
          "SELL signal: BearConfirmBuf[1]==1.0 (Resistance CONFIRMED) AND BearSLBuf[1]>0",
          "SL for bulls: retestLow (wick low of the retest candle)",
          "SL for bears: retestHigh (wick high of the retest candle)",
          "TP: entry ± slDist × InpRR  (default RR = 2.0)",
        ],
        output: [
          "Reads iCustom() buffers 0–3 from Classic_SNR_State_Module",
          "Journal: TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | SIGNAL_BLOCKED",
          "Inputs: module_name · module_tf · module_lookback · magic · risk_pct · rr · breakeven_r",
          "Compatible with any Phase 2 state module — change InpModuleName to swap modules",
        ],
        status: "ready",
        generate: () => generatePhase3Ea(CLASSIC_SNR_EA_CONFIG),
      },
      {
        id: "gap-snr-exec",
        filename: "Gap_SNR_Execution_EA.mq5",
        name: "Gap SNR Execution EA",
        description:
          "Expert Advisor that consumes Gap_SNR_State_Module.mq5 via iCustom(). " +
          "Enters when a Gap S/R level CONFIRMED signal fires. Gap SNR uses candle-pair " +
          "direction CONTINUATION (Bull→Bull / Bear→Bear) instead of reversal pairs.",
        rules: [
          "BUY signal:  BullConfirmBuf[1]==1.0 (Gap Support CONFIRMED) AND BullSLBuf[1]>0",
          "SELL signal: BearConfirmBuf[1]==1.0 (Gap Resistance CONFIRMED) AND BearSLBuf[1]>0",
          "SL for bulls: retestLow  |  SL for bears: retestHigh",
          "TP: entry ± slDist × InpRR  (default RR = 2.0)",
          "Spread filter, max-trades guard, breakeven management identical to FVG EA",
        ],
        output: [
          "Reads iCustom() buffers 0–3 from Gap_SNR_State_Module",
          "Journal: TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | SIGNAL_BLOCKED",
          "Inputs: module_name · module_tf · module_lookback · magic · risk_pct · rr · breakeven_r",
          "Compatible with any Phase 2 state module — change InpModuleName to swap modules",
        ],
        status: "ready",
        generate: () => generatePhase3Ea(GAP_SNR_EA_CONFIG),
      },
    ],
  },

  // ── 5. MTF Strategy Orchestration ────────────────────────────────────────
  {
    id: "strategy",
    label: "Strategy",
    fullName: "MTF Strategy Orchestration",
    icon: Network,
    phaseTag: "Phase 3 Active",
    phaseActive: true,
    description:
      "Multi-timeframe strategy orchestrators. Each orchestrator chains " +
      "Phase 2 State Module signals across timeframes: step N only becomes " +
      "ACTIVE after step N-1 is CONFIRMED. When all steps confirm in order, " +
      "the EA executes with risk management inherited from Phase 3. " +
      "Each step's module, timeframe, buffer index, and expiry are independently configurable.",
    modules: [
      {
        id: "fvg-3tf-bull",
        filename: "MTF_FVG_3TF_Bull.mq5",
        name: "FVG 3-TF Bull  (D1 → H4 → M30)",
        description:
          "D1 FVG confirmed → H4 FVG confirmed → M30 FVG entry signal → BUY. " +
          "Classic top-down confluence. Requires FVG_State_Module.mq5 in MQL5/Indicators/. " +
          "Place this EA in MQL5/Experts/ and attach to a M30 chart.",
        rules: [
          "Step 1 (D1): BullConfirmBuf[1]==1.0 on D1 FVG_State_Module — sets daily bias",
          "Step 2 (H4): BullConfirmBuf[1]==1.0 on H4 FVG_State_Module — activates only after Step 1",
          "Step 3 (M30): BullConfirmBuf[1]==1.0 on M30 FVG_State_Module — activates only after Step 2",
          "Execution: BUY on M30 bar open after all 3 steps confirmed — SL from BullSLBuf",
          "Chain reset: if any step expires (configurable bars) before confirming, restart from that step",
          "Each step is independently configurable: module · timeframe · buffer index · expiry",
        ],
        output: [
          "Journal: STEP_N_ACTIVE | STEP_N_CONFIRMED | STEP_N_EXPIRED | ALL_STEPS_CONFIRMED",
          "Journal: TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | SIGNAL_BLOCKED",
          "Step statuses: WAITING → ACTIVE → CONFIRMED → (EXPIRED resets chain)",
          "Execution inputs: risk_pct · rr · breakeven_r · max_trades · max_spread · sl_buf_idx",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(FVG_3TF_BULL),
      },
      {
        id: "fvg-3tf-bear",
        filename: "MTF_FVG_3TF_Bear.mq5",
        name: "FVG 3-TF Bear  (D1 → H4 → M30)",
        description:
          "D1 FVG bear confirm → H4 FVG bear confirm → M30 FVG entry signal → SELL. " +
          "Mirror of the bull strategy. Run both with different magic numbers to trade both directions.",
        rules: [
          "Step 1 (D1): BearConfirmBuf[1]==1.0 on D1",
          "Step 2 (H4): BearConfirmBuf[1]==1.0 on H4 — activates only after Step 1",
          "Step 3 (M30): BearConfirmBuf[1]==1.0 on M30 — activates only after Step 2",
          "Execution: SELL on M30 bar open — SL from BearSLBuf",
        ],
        output: [
          "Same journal events as the bull orchestrator — direction is SELL throughout",
          "Magic number default: 20250602 (different from bull's 20250601)",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(FVG_3TF_BEAR),
      },
      {
        id: "fvg-2tf-bull",
        filename: "MTF_FVG_2TF_Bull.mq5",
        name: "FVG 2-TF Bull  (H4 → M30)",
        description:
          "H4 FVG bull confirm → M30 FVG entry signal → BUY. " +
          "Shorter intraday chain — no daily filter.",
        rules: [
          "Step 1 (H4): BullConfirmBuf[1]==1.0 on H4",
          "Step 2 (M30): BullConfirmBuf[1]==1.0 on M30 — activates only after Step 1",
          "Execution: BUY — SL from BullSLBuf on M30 module",
        ],
        output: [
          "2-step chain — fewer confirmations required, higher trade frequency",
          "Max trades default: 2 (vs 1 for the 3-TF strategies)",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(FVG_2TF_BULL),
      },
      {
        id: "fvg-2tf-bear",
        filename: "MTF_FVG_2TF_Bear.mq5",
        name: "FVG 2-TF Bear  (H4 → M30)",
        description:
          "H4 FVG bear confirm → M30 FVG entry signal → SELL. " +
          "Mirror of the 2-TF bull strategy.",
        rules: [
          "Step 1 (H4): BearConfirmBuf[1]==1.0 on H4",
          "Step 2 (M30): BearConfirmBuf[1]==1.0 on M30 — activates only after Step 1",
          "Execution: SELL — SL from BearSLBuf on M30 module",
        ],
        output: ["2-step chain — mirror of 2-TF bull strategy", "Magic number default: 20250604"],
        status: "ready",
        generate: () => generateMtfOrchestrator(FVG_2TF_BEAR),
      },
      {
        id: "ob-3tf-bull",
        filename: "MTF_OB_3TF_Bull.mq5",
        name: "OB 3-TF Bull  (D1 → H4 → M30)",
        description:
          "D1 OB confirmed → H4 OB confirmed → M30 OB entry signal → BUY. " +
          "Classic top-down OB confluence. Requires OB_State_Module.mq5 in MQL5/Indicators/. " +
          "Place this EA in MQL5/Experts/ and attach to a M30 chart.",
        rules: [
          "Step 1 (D1): BullConfirmBuf[1]==1.0 on D1 OB_State_Module — sets daily OB bias",
          "Step 2 (H4): BullConfirmBuf[1]==1.0 on H4 OB_State_Module — activates only after Step 1",
          "Step 3 (M30): BullConfirmBuf[1]==1.0 on M30 OB_State_Module — activates only after Step 2",
          "Execution: BUY on M30 bar open after all 3 steps confirmed — SL from BullSLBuf",
          "Chain reset: if any step expires before confirming, restart from that step",
        ],
        output: [
          "Journal: STEP_N_ACTIVE | STEP_N_CONFIRMED | STEP_N_EXPIRED | ALL_STEPS_CONFIRMED",
          "Journal: TRADE_OPENED | TRADE_FAILED | BREAKEVEN_SET | SIGNAL_BLOCKED",
          "Inputs: risk_pct · rr · breakeven_r · max_trades · max_spread · sl_buf_idx (per step)",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(OB_3TF_BULL),
      },
      {
        id: "ob-3tf-bear",
        filename: "MTF_OB_3TF_Bear.mq5",
        name: "OB 3-TF Bear  (D1 → H4 → M30)",
        description:
          "D1 OB bear confirm → H4 OB bear confirm → M30 OB entry signal → SELL. " +
          "Mirror of the 3-TF OB bull strategy. Run both with different magic numbers.",
        rules: [
          "Step 1 (D1): BearConfirmBuf[1]==1.0 on D1",
          "Step 2 (H4): BearConfirmBuf[1]==1.0 on H4 — activates only after Step 1",
          "Step 3 (M30): BearConfirmBuf[1]==1.0 on M30 — activates only after Step 2",
          "Execution: SELL on M30 bar open — SL from BearSLBuf",
        ],
        output: [
          "Same journal events as the bull orchestrator — direction is SELL throughout",
          "Magic number default: 20250702",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(OB_3TF_BEAR),
      },
      {
        id: "ob-2tf-bull",
        filename: "MTF_OB_2TF_Bull.mq5",
        name: "OB 2-TF Bull  (H4 → M30)",
        description:
          "H4 OB bull confirm → M30 OB entry signal → BUY. " +
          "Shorter intraday OB chain — H4 zone sets the bias, M30 provides the retest entry.",
        rules: [
          "Step 1 (H4): BullConfirmBuf[1]==1.0 on H4",
          "Step 2 (M30): BullConfirmBuf[1]==1.0 on M30 — activates only after Step 1",
          "Execution: BUY — SL from BullSLBuf on M30 module",
        ],
        output: [
          "2-step chain — fewer confirmations, higher trade frequency than 3-TF",
          "Magic number default: 20250703",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(OB_2TF_BULL),
      },
      {
        id: "ob-2tf-bear",
        filename: "MTF_OB_2TF_Bear.mq5",
        name: "OB 2-TF Bear  (H4 → M30)",
        description:
          "H4 OB bear confirm → M30 OB entry signal → SELL. " +
          "Mirror of the 2-TF OB bull strategy.",
        rules: [
          "Step 1 (H4): BearConfirmBuf[1]==1.0 on H4",
          "Step 2 (M30): BearConfirmBuf[1]==1.0 on M30 — activates only after Step 1",
          "Execution: SELL — SL from BearSLBuf on M30 module",
        ],
        output: [
          "2-step chain — mirror of 2-TF OB bull strategy",
          "Magic number default: 20250704",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(OB_2TF_BEAR),
      },
      {
        id: "breakout-2tf-bull",
        filename: "MTF_Breakout_2TF_Bull.mq5",
        name: "Breakout 2-TF Bull  (H4 → M30)",
        description:
          "H4 RBS confirm → M30 RBS entry signal → BUY. " +
          "H4 breakout flip confirmed first (Classic SNR broken + retest held), " +
          "then M30 retest of its own RBS level triggers entry. " +
          "Requires Breakout_State_Module.mq5 in MQL5/Indicators/.",
        rules: [
          "Step 1 (H4): BullConfirmBuf[1]==1.0 — RBS CONFIRMED on H4",
          "Step 2 (M30): BullConfirmBuf[1]==1.0 — RBS CONFIRMED on M30",
          "Execution: BUY — SL from BullSLBuf (wick low of M30 retest bar)",
        ],
        output: [
          "2-step chain using Breakout_State_Module at both steps",
          "Magic number default: 20250705",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(BREAKOUT_2TF_BULL),
      },
      {
        id: "breakout-2tf-bear",
        filename: "MTF_Breakout_2TF_Bear.mq5",
        name: "Breakout 2-TF Bear  (H4 → M30)",
        description:
          "H4 SBR confirm → M30 SBR entry signal → SELL. " +
          "Mirror of the 2-TF Breakout bull strategy.",
        rules: [
          "Step 1 (H4): BearConfirmBuf[1]==1.0 — SBR CONFIRMED on H4",
          "Step 2 (M30): BearConfirmBuf[1]==1.0 — SBR CONFIRMED on M30",
          "Execution: SELL — SL from BearSLBuf (wick high of M30 retest bar)",
        ],
        output: [
          "2-step chain using Breakout_State_Module at both steps",
          "Magic number default: 20250706",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(BREAKOUT_2TF_BEAR),
      },
      {
        id: "bb-2tf-bull",
        filename: "MTF_BB_2TF_Bull.mq5",
        name: "BB 2-TF Bull  (H4 → M30)",
        description:
          "H4 Bullish Breaker Block confirm → M30 BB entry signal → BUY. " +
          "H4 OB broken and flipped, then M30 retest of the recycled zone triggers entry. " +
          "Requires BB_State_Module.mq5 in MQL5/Indicators/.",
        rules: [
          "Step 1 (H4): BullConfirmBuf[1]==1.0 — Bullish BB CONFIRMED on H4",
          "Step 2 (M30): BullConfirmBuf[1]==1.0 — Bullish BB CONFIRMED on M30",
          "Execution: BUY — SL from BullSLBuf (wick low of M30 retest bar)",
        ],
        output: [
          "2-step chain using BB_State_Module at both steps",
          "Magic number default: 20250707",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(BB_2TF_BULL),
      },
      {
        id: "bb-2tf-bear",
        filename: "MTF_BB_2TF_Bear.mq5",
        name: "BB 2-TF Bear  (H4 → M30)",
        description:
          "H4 Bearish Breaker Block confirm → M30 BB entry signal → SELL. " +
          "Mirror of the 2-TF BB bull strategy.",
        rules: [
          "Step 1 (H4): BearConfirmBuf[1]==1.0 — Bearish BB CONFIRMED on H4",
          "Step 2 (M30): BearConfirmBuf[1]==1.0 — Bearish BB CONFIRMED on M30",
          "Execution: SELL — SL from BearSLBuf (wick high of M30 retest bar)",
        ],
        output: [
          "2-step chain using BB_State_Module at both steps",
          "Magic number default: 20250708",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(BB_2TF_BEAR),
      },
      {
        id: "bos-bias-fvg-bull",
        filename: "MTF_BOS_Bias_FVG_Bull.mq5",
        name: "BOS Bias + FVG Bull  (D1 → H4)",
        description:
          "D1 structural bias BULL (BOS_State_Module) → H4 FVG confirmed → BUY. " +
          "Step 1 gates instantly if D1 BOS trend is already BULL — no waiting for a new BOS event. " +
          "Requires BOS_State_Module.mq5 and FVG_State_Module.mq5 in MQL5/Indicators/. " +
          "Attach to H4 chart.",
        rules: [
          "Step 1 (D1 BOS): BullTrendBuf[1]==1.0 — persistent; confirms immediately if D1 is already BULL",
          "Step 2 (H4 FVG): BullConfirmBuf[1]==1.0 — FVG retested + close held above UL",
          "Execution: BUY on H4 bar open — SL from H4 BullSLBuf (retest low)",
          "If D1 bias flips before Step 2 fires, next chain cycle re-checks trend and waits",
        ],
        output: [
          "Uses two different Phase 2 modules: BOS_State_Module (bias) + FVG_State_Module (entry)",
          "Journal: STEP_N_ACTIVE | STEP_N_CONFIRMED | STEP_N_EXPIRED | TRADE_OPENED",
          "Magic: 20250801 — change if running alongside other strategies",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(BOS_BIAS_FVG_BULL),
      },
      {
        id: "bos-bias-fvg-bear",
        filename: "MTF_BOS_Bias_FVG_Bear.mq5",
        name: "BOS Bias + FVG Bear  (D1 → H4)",
        description:
          "D1 structural bias BEAR → H4 FVG confirmed → SELL. " +
          "Mirror of the BOS Bias + FVG Bull strategy. Attach to H4 chart.",
        rules: [
          "Step 1 (D1 BOS): BearTrendBuf[1]==1.0 — confirms immediately if D1 is already BEAR",
          "Step 2 (H4 FVG): BearConfirmBuf[1]==1.0 — FVG retested + close held below LL",
          "Execution: SELL on H4 bar open — SL from H4 BearSLBuf (retest high)",
        ],
        output: ["Uses BOS_State_Module (bias) + FVG_State_Module (entry)", "Magic: 20250802"],
        status: "ready",
        generate: () => generateMtfOrchestrator(BOS_BIAS_FVG_BEAR),
      },
      {
        id: "bos-bias-ob-bull",
        filename: "MTF_BOS_Bias_OB_Bull.mq5",
        name: "BOS Bias + OB Bull  (D1 → H4)",
        description:
          "D1 structural bias BULL → H4 Order Block confirmed → BUY. " +
          "Higher-conviction variant: daily structure aligns with H4 institutional zone retest. " +
          "Requires BOS_State_Module.mq5 and OB_State_Module.mq5. Attach to H4 chart.",
        rules: [
          "Step 1 (D1 BOS): BullTrendBuf[1]==1.0 — persistent bias gate",
          "Step 2 (H4 OB): BullConfirmBuf[1]==1.0 — OB retested + close held above OB high",
          "Execution: BUY on H4 bar open — SL from H4 BullSLBuf (retest low)",
        ],
        output: ["Uses BOS_State_Module (bias) + OB_State_Module (entry)", "Magic: 20250803"],
        status: "ready",
        generate: () => generateMtfOrchestrator(BOS_BIAS_OB_BULL),
      },
      {
        id: "bos-bias-ob-bear",
        filename: "MTF_BOS_Bias_OB_Bear.mq5",
        name: "BOS Bias + OB Bear  (D1 → H4)",
        description:
          "D1 structural bias BEAR → H4 Order Block confirmed → SELL. " +
          "Mirror of the BOS Bias + OB Bull strategy. Attach to H4 chart.",
        rules: [
          "Step 1 (D1 BOS): BearTrendBuf[1]==1.0 — persistent bias gate",
          "Step 2 (H4 OB): BearConfirmBuf[1]==1.0 — OB retested + close held below OB low",
          "Execution: SELL on H4 bar open — SL from H4 BearSLBuf (retest high)",
        ],
        output: ["Uses BOS_State_Module (bias) + OB_State_Module (entry)", "Magic: 20250804"],
        status: "ready",
        generate: () => generateMtfOrchestrator(BOS_BIAS_OB_BEAR),
      },
      {
        id: "bos-ob-fvg-bull",
        filename: "MTF_BOS_OB_FVG_Bull.mq5",
        name: "BOS + OB + FVG Bull  (D1 → H4 → M30)",
        description:
          "Highest-confluence 3-step cross-module strategy: " +
          "D1 structural bias BULL → H4 OB confirmed (zone established) → M30 FVG entry → BUY. " +
          "Three independent modules confirm at three timeframes before any trade is placed. " +
          "Requires BOS_State_Module.mq5, OB_State_Module.mq5, FVG_State_Module.mq5. Attach to M30 chart.",
        rules: [
          "Step 1 (D1 BOS): BullTrendBuf[1]==1.0 — gates instantly if D1 trend already BULL",
          "Step 2 (H4 OB): BullConfirmBuf[1]==1.0 — H4 OB retested and held (institutional zone confirmed)",
          "Step 3 (M30 FVG): BullConfirmBuf[1]==1.0 — M30 FVG retested and held (precision entry)",
          "Execution: BUY on M30 bar open — SL from M30 BullSLBuf (FVG retest low)",
          "Default RR = 2.5 (elevated for triple-confluence requirement)",
        ],
        output: [
          "Three different Phase 2 modules across three timeframes — zero shared indicator handles",
          "Journal: STEP_N_ACTIVE | STEP_N_CONFIRMED | STEP_N_EXPIRED | ALL_STEPS_CONFIRMED | TRADE_OPENED",
          "Magic: 20250805",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(BOS_OB_FVG_BULL),
      },
      {
        id: "bos-ob-fvg-bear",
        filename: "MTF_BOS_OB_FVG_Bear.mq5",
        name: "BOS + OB + FVG Bear  (D1 → H4 → M30)",
        description:
          "D1 structural bias BEAR → H4 OB confirmed → M30 FVG entry → SELL. " +
          "Mirror of the triple-confluence bull strategy. Attach to M30 chart.",
        rules: [
          "Step 1 (D1 BOS): BearTrendBuf[1]==1.0",
          "Step 2 (H4 OB): BearConfirmBuf[1]==1.0",
          "Step 3 (M30 FVG): BearConfirmBuf[1]==1.0",
          "Execution: SELL — SL from M30 BearSLBuf (FVG retest high)  |  RR = 2.5",
        ],
        output: [
          "Uses BOS_State_Module + OB_State_Module + FVG_State_Module across D1 / H4 / M30",
          "Magic: 20250806",
        ],
        status: "ready",
        generate: () => generateMtfOrchestrator(BOS_OB_FVG_BEAR),
      },
      {
        id: "mtf-custom",
        filename: "MTF_Custom.mq5",
        name: "Custom Strategy Builder",
        description:
          "Define a fully custom N-step orchestration: choose any Phase 2 State Module " +
          "for each step, set timeframes, buffer indices, and expiry independently. " +
          "Mix modules across steps (e.g. D1 OB → H4 FVG → M15 CHoCH).",
        status: "planned",
      },
    ],
  },

  // ── 6. Supply & Demand ────────────────────────────────────────────────────
  {
    id: "supply-demand",
    label: "S&D",
    fullName: "Supply & Demand",
    icon: ArrowUpDown,
    phaseTag: "Phase 1",
    phaseActive: true,
    description:
      "Institutional supply & demand zone detection. Engulfing patterns fall under " +
      "S&D too — every engulfing/base zone marks an area where orders accumulated and " +
      "price is expected to react. Includes engulfing (EG/EF), strong engulfing, and " +
      "rally/drop base zones (RBR/DBD), plus planned zone-state variants.",
    modules: [
      {
        id: "eng-detector",
        filename: "ENG_Detector.mq5",
        name: "Engulfing + Engulfing Failed",
        description:
          "Detects engulfing zones (EG) and tracks their lifecycle. When price closes " +
          "through an EG zone, it becomes an EF (engulfing failed) zone with opposite " +
          "direction. MES definition: zone = C1 full wick range. Multi-candle aware.",
        rules: [
          "Bullish EG: C1 bearish, C2 closes > C1.High (upper wick) — any # of candles",
          "Bearish EG: C1 bullish, C2 closes < C1.Low (lower wick) — any # of candles",
          "Zone = C1 full wick range (hi=C1.High, lo=C1.Low)",
          "Bull EG fails when close < lo → flips to Bear EF (same zone)",
          "Bear EG fails when close > hi → flips to Bull EF (same zone)",
          "Lifecycle: ACTIVE (detected) → RETESTED (wick enters) → CONFIRMED (close beyond)",
        ],
        output: [
          "Blue/Red rectangle for EG zones (bull/bear direction)",
          "Orange rectangle for EF zones (failed, direction flipped)",
          "Zone label: 'EG' for active engulfing, 'EF' for failed",
          "Journal: EG_BULL | EG_BEAR | EG_*_RETESTED | EG_*_CONFIRMED | EG_*_FAILED",
        ],
        status: "ready",
        generate: generateEngulfingDetector,
      },
      {
        id: "seg-detector",
        filename: "SEG_Detector.mq5",
        name: "Strong Engulfing",
        description:
          "Detects STRONG engulfings only — the decisive 2-candle case where the " +
          "second candle alone breaks and closes beyond the wick of the first. " +
          "Marks the C1 wick-range zone (blue bull / red bear). No EF lifecycle.",
        rules: [
          "Strong = exactly 2 candles (no multi-candle build-up)",
          "Bullish SEG: C1 bearish, C2 bullish, C2 close > C1.High (upper wick)",
          "Bearish SEG: C1 bullish, C2 bearish, C2 close < C1.Low (lower wick)",
          "Zone = C1 full wick range (hi=C1.High, lo=C1.Low)",
          "Traded through → invalid: bull zone dies on close below it, bear zone on close above it",
          "Zones expire after InpExpiryBars bars",
        ],
        output: [
          "Blue rectangle for bullish strong engulfing zones",
          "Red rectangle for bearish strong engulfing zones",
          "Zone label: 'SEG'",
          "Journal: SEG_BULL | SEG_BEAR | SEG_EXPIRED",
        ],
        status: "ready",
        generate: generateStrongEngulfingDetector,
      },
      {
        id: "rbr-dbd-detector",
        filename: "RBR_DBD_Detector.mq5",
        name: "RBR / DBD (Supply & Demand)",
        description:
          "Detects Rally-Base-Rally (RBR → Demand) and Drop-Base-Drop (DBD → Supply) " +
          "base zones. A strong impulse leg, a 1–6 candle small-bodied base, then a " +
          "strong leg in the same direction breaking out of the base. Zone = base range.",
        rules: [
          "Leg candle: strong body (body/range ≥ InpImpulseRatio) in the move direction",
          "Base: 1–6 small-bodied candles (body/range ≤ InpBaseMaxRatio), any direction",
          "Legs must be larger than the base (leg range ≥ InpLegBaseMult × avg base range)",
          "Leg-out must close OUT of the base (above base high for RBR, below base low for DBD)",
          "RBR (bull legs) → Demand zone; DBD (bear legs) → Supply zone",
          "Zone = base high..low; traded through (close beyond) → invalid",
        ],
        output: [
          "Green rectangle for RBR demand zones",
          "Red rectangle for DBD supply zones",
          "Zone label: 'RBR (Demand)' / 'DBD (Supply)'",
          "Journal: RBR_DEMAND | DBD_SUPPLY | *_INVALIDATED | RBR_DBD_EXPIRED",
        ],
        status: "ready",
        generate: generateRbrDbdDetector,
      },
      {
        id: "mef-detector",
        filename: "MEF_Detector.mq5",
        name: "MEF (Manipulation Entry Formula)",
        description:
          "Multi-timeframe engulfing confluence. A strong engulfing on the main TF " +
          "that contains a Gap SNR one TF lower, which in turn contains an RBR (bull) " +
          "or DBD (bear) two TFs lower. Marks the confluence zone. Detection only.",
        rules: [
          "Main TF: STRONG (2-candle) engulfing only — C2 closes beyond C1's wick",
          "1 TF lower: a Gap SNR forms inside the engulfing candle (Support=bull, Resistance=bear)",
          "2 TF lower: an RBR (bull) / DBD (bear) base forms inside that area",
          "Bullish MEF = strong bull engulfing + Gap Support + RBR",
          "Bearish MEF = strong bear engulfing + Gap Resistance + DBD",
          "Gap level + RBR/DBD base must sit within the engulfing candle's range & time",
        ],
        output: [
          "Engulfing candle zone (green bull / red bear) with 'Bull MEF' / 'Bear MEF' label",
          "Gold dashed line = Gap SNR level",
          "Purple rectangle = RBR/DBD base zone (entry area)",
          "Journal: MEF_CREATED | direction | main_tf | gap_tf | base_tf | time",
        ],
        status: "ready",
        generate: generateMefDetector,
      },
      {
        id: "qm-mef-detector",
        filename: "QM_MEF_Detector.mq5",
        name: "QM_MEF (Quasimodo MEF)",
        description:
          "Detects a close-based Quasimodo that is born from a higher-TF strong " +
          "engulfing candle (not a general Quasimodo). The left shoulder is the entry. " +
          "Stronger when a Gap SNR / RBR / DBD sits near the left shoulder.",
        rules: [
          "HTF: a STRONG (2-candle) engulfing candle — no engulfing, no QM_MEF",
          "Quasimodo uses candle CLOSES, not wicks (highs/lows = closes)",
          "Quasimodo points: Left Shoulder → Head → Right Shoulder (close-based)",
          "Bullish QM: LS low → pullback high → Head (lower low) → higher high",
          "Bearish QM: LS high → pullback low → Head (higher high) → lower low",
          "Entry = Left Shoulder (Right Shoulder forms there on return)",
          "SL = beyond the Head (below for bull, above for bear)",
          "TP = the pullback extreme (above the pullback high / below the pullback low)",
          "QM must form inside the engulfing candle's time/range on the LTF",
          "Strength = STRONG if Gap SNR / RBR / DBD sits near the left shoulder, else normal",
          "Head break → invalid: close below the head (bull) / above the head (bear) kills it",
        ],
        output: [
          "HTF engulfing zone (green bull / red bear) + 'Bull/Bear QM_MEF [STRONG|normal]'",
          "Gold ray = Left Shoulder (entry); 'Right Shoulder (entry)' label on the right",
          "Dotted Head marker + level labelled 'Head (SL beyond)'",
          "Blue dash-dot 'TP (pullback)' level",
          "Purple confluence marker (Gap SNR line or RBR/DBD base box) if present",
          "Journal: QM_MEF_CREATED | dir | HTF | LTF | engulf | left_shoulder(entry) | head(SL) | TP(pullback) | confluence | strength",
        ],
        status: "ready",
        generate: generateQmMefDetector,
      },
      {
        id: "snrc2-detector",
        filename: "SNRC2_Detector.mq5",
        name: "SNRC2 (S&R Continuation 2)",
        description:
          "Continuation pattern after a Classic SNR break with a manipulation " +
          "pullback back across the broken level before continuation. Detects both " +
          "bearish and bullish. The original level becomes the entry.",
        rules: [
          "Setup = HTF engulfing FIRST, then the pattern (like MEF): the engulfing must precede the structure (InpHtfTF / InpHtfLookback)",
          "Bearish: 1st Low → 2nd Low (break below 1st) → manipulation high (above 1st Low) → continuation lower low",
          "Bullish: 1st High → 2nd High (break above 1st) → manipulation low (below 1st High) → continuation higher high",
          "Resistance/support = Classic SNR levels (candle-pair reversal close): bull→bear = resistance, bear→bull = support",
          "Manipulation must NOT exceed that Classic SNR level (no higher high in a downtrend / no lower low in an uptrend)",
          "Built from alternating close-confirmed swing pivots (InpSwingStrength)",
          "Entry = the Classic SNR level of the 1st low/high (on the SNR, not the wick); SL = manipulation extreme",
          "Invalidation: price TRADES beyond the SL (intrabar) → setup deleted",
        ],
        output: [
          "Gold entry line on the Classic SNR level (short line, freezes when tapped)",
          "Red horizontal SL line at the manipulation extreme",
          "Markers: 1st Low/High, 2nd Low/High, Cont LL/HH",
          "Journal: SNRC2_CREATED | dir | entry | SL | 2nd | cont | SNRC2_ENTRY_TAPPED | SNRC2_INVALIDATED",
        ],
        status: "ready",
        generate: generateSnrc2Detector,
      },
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

  // ── 7. Built-in MT5 Indicators (referenceable primitives) ──────────────────
  {
    id: "builtin-indicators",
    label: "Built-ins",
    fullName: "Built-in MT5 Indicators",
    icon: BarChart2,
    phaseTag: "Referenceable",
    phaseActive: true,
    description:
      "Native MT5 indicators. These are NOT rebuilt as custom modules — the AI " +
      "references them through MQL5's built-in functions (iX handle + CopyBuffer), " +
      "then combines them with strategy primitives (cross, divergence, filters). " +
      "Custom modules are reserved for concepts MT5 can't express natively.",
    modules: INDICATOR_REGISTRY.map(
      (ind): ModuleEntry => ({
        id: `builtin-${ind.id}`,
        filename: ind.signature,
        name: ind.name,
        description: ind.description,
        rules: [
          `Category: ${INDICATOR_CATEGORY_LABEL[ind.category]} · ${ind.via === "icustom" ? "iCustom (Examples)" : "native " + ind.mql5 + "()"}`,
          ...(ind.params.length > 0
            ? ind.params.map(
                (p) =>
                  `${p.name} = ${p.default}` +
                  (p.note ? ` (${p.note})` : p.min !== undefined ? ` [${p.min}–${p.max}]` : ""),
              )
            : ["no parameters"]),
          `renders ${ind.subWindow ? "in a separate sub-window" : "on the price chart"}`,
        ],
        output: [
          ...ind.buffers.map((b) => `buffer ${b.index}: ${b.name}`),
          `Applications: ${ind.applications.join(", ")}`,
        ],
        status: "builtin",
      }),
    ),
  },

  // ── 8. Indicators ─────────────────────────────────────────────────────────
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
          "Simple Moving Average with golden/death cross detection and " + "configurable periods.",
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
        id: "rsi-hidden-divergence",
        filename: "RSI_Hidden_Divergence_Detector.mq5",
        name: "RSI Hidden Divergence",
        description:
          "Trend-CONTINUATION setup. Bullish HD: price makes a Higher Low while RSI " +
          "makes a Lower Low. Bearish HD: price makes a Lower High while RSI makes a " +
          "Higher High. A SETUP module only — it does not decide direction; pair it " +
          "with a Direction Brain (BOS / EMA) and an Execution module (IFVG / OB).",
        rules: [
          "Bullish HD: Price Low2 > Low1 (HL) AND RSI Low2 < Low1 (LL)",
          "Bearish HD: Price High2 < High1 (LH) AND RSI High2 > High1 (HH)",
          "Swings = pivots (InpPivotLeft/Right bars each side); RSI read at the pivot bar",
          "Two swings must be InpMinBars..InpMaxBars apart",
          "Confirmed only after the second swing pivot completes",
        ],
        output: [
          "Renders in its own sub-window: plots the RSI line with 30/70 guides",
          "Draws the divergence on BOTH panes — price line on the main chart, RSI line in the sub-window",
          "Buffer 0: RSIPlotBuf (the RSI line) · Buffer 1: BullHiddenDivBuf · Buffer 2: BearHiddenDivBuf",
          "Green legs for bullish HD + 'Bull HD' label; red legs for bearish HD + 'Bear HD' label",
          "Journal: RSI_HD_BULL | RSI_HD_BEAR | price/RSI swings | time",
          "Inputs: rsi_period · pivot_left · pivot_right · min_bars · max_bars",
        ],
        status: "ready",
        generate: generateRsiHiddenDivergenceDetector,
      },
      {
        id: "macd",
        filename: "IND_MACD_Detector.mq5",
        name: "MACD",
        description:
          "MACD line, signal line, and histogram with crossover and zero-line " + "cross logging.",
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

// ─── EA Backtest Panel ───────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, ".");
}
function oneYearAgo() {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10).replace(/-/g, ".");
}

function CatalogKindBadge({ kind }: { kind: ModuleCatalogKind }) {
  const meta: Record<ModuleCatalogKind, { label: string; tone: string; hint: string }> = {
    standalone_indicator: {
      label: "Standalone indicator",
      tone: "bg-violet-500/10 text-violet-300 border-violet-500/25",
      hint: "Download, compile, attach to chart — not a Strategy Builder brain slot",
    },
    state_module: {
      label: "State module",
      tone: "bg-amber-500/10 text-amber-300 border-amber-500/25",
      hint: "iCustom state machine for Phase 3 EAs — not in 4-Brain picker yet",
    },
    full_ea: {
      label: "Full EA",
      tone: "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
      hint: "Complete Expert Advisor — run on its own in MT5",
    },
    brain_composable: {
      label: "Brain composable",
      tone: "bg-sky-500/10 text-sky-300 border-sky-500/25",
      hint: "Also available in Strategy Builder as a verified brain module",
    },
  };
  const m = meta[kind];
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${m.tone}`}
      title={m.hint}
    >
      {m.label}
    </span>
  );
}

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
  if (status === "builtin") {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 flex items-center gap-1 shrink-0">
        <BarChart2 className="h-2.5 w-2.5" /> Built-in
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

function AdmissionBadge({ status }: { status: ModuleAdmissionStatus }) {
  const meta = MODULE_ADMISSION_STATUS_META[status];
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${meta.tone}`}
    >
      {meta.shortLabel}
    </span>
  );
}

function ModuleAdmissionReport() {
  const admissions = Object.values(MODULE_ADMISSION).sort((a, b) => a.label.localeCompare(b.label));
  const verified = admissions.filter((m) => m.status === "verified_state_machine");
  const template = admissions.filter((m) => m.status === "template_only");
  const notVerified = admissions.filter((m) => m.status === "not_verified");
  const detectorOnly = admissions.filter((m) => m.status === "detector_only");
  const coveredBrainModules = ALL_BRAIN_MODULES.filter((m) => getModuleContract(m.id));
  const missingBrainModules = ALL_BRAIN_MODULES.filter((m) => !getModuleContract(m.id));
  const contractlessAi = admissions.filter(
    (m) => m.aiVocabulary && m.contractRequired && !MODULE_CONTRACTS[m.id],
  );

  const stats = [
    {
      label: "Verified",
      value: verified.length,
      tone: MODULE_ADMISSION_STATUS_META.verified_state_machine.tone,
      helper: "safe for AI 4-Brain wiring",
    },
    {
      label: "Template",
      value: template.length,
      tone: MODULE_ADMISSION_STATUS_META.template_only.tone,
      helper: "deterministic, limited contract",
    },
    {
      label: "Guarded",
      value: notVerified.length,
      tone: MODULE_ADMISSION_STATUS_META.not_verified.tone,
      helper: "visible but guarded",
    },
    {
      label: "Detector only",
      value: detectorOnly.length,
      tone: MODULE_ADMISSION_STATUS_META.detector_only.tone,
      helper: `${coveredBrainModules.length}/${ALL_BRAIN_MODULES.length} builder modules contracted`,
    },
  ];

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 px-4 py-3 space-y-3">
      <div className="flex items-start gap-3">
        <Network className="h-4 w-4 text-primary shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm">Module admission status</p>
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-primary/10 text-primary border-primary/20">
              Phase 1H visible
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            This is the AI builder admission boundary. A module must be verified or deliberately
            marked as guarded, template-only, or detector-only before the system can trust it.
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-4 gap-2">
        {stats.map((stat) => (
          <div key={stat.label} className={`rounded border px-3 py-2 ${stat.tone}`}>
            <div className="text-lg font-semibold leading-none">{stat.value}</div>
            <div className="text-[10px] font-medium mt-1">{stat.label}</div>
            <div className="text-[10px] opacity-80 mt-0.5">{stat.helper}</div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 gap-2">
        {admissions.map((admission) => {
          const contract = getModuleContract(admission.id);
          return (
            <div
              key={admission.id}
              className="rounded border border-border/50 bg-background/35 px-3 py-2 text-xs"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">{admission.label}</span>
                <AdmissionBadge status={admission.status} />
              </div>
              <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground flex-wrap">
                {contract?.smPrefix && <span className="font-mono">{contract.smPrefix}</span>}
                {contract ? (
                  <>
                    <span>{contract.supportedRoles.join(" / ")}</span>
                    <span>{contract.semanticEvents.length} events</span>
                  </>
                ) : (
                  <span>{admission.aiVocabulary ? "AI vocabulary" : "not AI vocabulary"}</span>
                )}
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground/70 leading-snug">
                {admission.notes}
              </p>
            </div>
          );
        })}
      </div>

      {(missingBrainModules.length > 0 || contractlessAi.length > 0) && (
        <div className="text-xs text-amber-300 border border-amber-500/20 bg-amber-500/10 rounded px-3 py-2">
          {missingBrainModules.length > 0 && (
            <span>
              Missing builder contracts: {missingBrainModules.map((m) => m.label).join(", ")}
            </span>
          )}
          {contractlessAi.length > 0 && (
            <span>
              {missingBrainModules.length > 0 ? " | " : ""}AI vocabulary without contract:{" "}
              {contractlessAi.map((m) => m.label).join(", ")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

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
            {mod.catalogKind && <CatalogKindBadge kind={mod.catalogKind} />}
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
  const readyCount = category.modules.filter((m) => m.status === "ready").length;
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
  const totalModules = TRADING_MODULES.reduce((sum, cat) => sum + cat.modules.length, 0);

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
          <div className="text-xs text-primary/80 space-y-2">
            <p className="font-semibold text-primary">
              Two catalogs — do not confuse them
            </p>
            <p>
              <span className="font-medium text-foreground/90">Strategy Builder</span> (
              <Link to="/build" className="underline hover:text-primary">
                New strategy
              </Link>
              ) composes <span className="font-medium">verified brain modules</span> (FVG, OB, EMA,
              BOS, etc.) into one self-contained EA. That picker only lists modules with embedded
              state machines the compiler can wire.
            </p>
            <p>
              <span className="font-medium text-foreground/90">Trading Modules</span> (this page) is
              a download library of standalone MT5 files — detectors, liquidity visualisers, state
              modules, and full EAs. Items like{" "}
              <span className="font-medium">FVG / OB / BB Liquidity Detector</span> are{" "}
              <span className="font-medium">not</span> brain slots: download → compile → attach to a
              chart on their own.
            </p>
            <p>
              Phase 1: {totalReady} of {totalModules} files ready · Detection → State → Execution
              pipeline for promoting a concept into Strategy Builder later.
            </p>
          </div>
        </div>

        <ModuleAdmissionReport />

        {/* Category tabs */}
        <Tabs defaultValue="smc">
          <div className="overflow-x-auto pb-1">
            <TabsList className="inline-flex h-auto gap-1 p-1">
              {TRADING_MODULES.map((cat) => {
                const ready = cat.modules.filter((m) => m.status === "ready").length;
                const Icon = cat.icon;
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
