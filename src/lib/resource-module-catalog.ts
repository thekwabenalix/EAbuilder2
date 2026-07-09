import { generateFvgDetector } from "@/lib/smc-modules/fvg-detector";
import { generateFvgInversionDetector } from "@/lib/smc-modules/fvg-inversion-detector";
import { generateObDetector } from "@/lib/smc-modules/ob-detector";
import { generateBbDetector } from "@/lib/smc-modules/bb-detector";
import { generateLiqSweepDetector } from "@/lib/smc-modules/liqsweep-detector";
import { generateSwingStructureDetector } from "@/lib/smc-modules/swing-structure-detector";
import { generateBosDetector } from "@/lib/smc-modules/bos-detector";
import { generateChochDetector } from "@/lib/smc-modules/choch-detector";
import { generateZoneLiquiditySetupIndicator } from "@/lib/smc-modules/zone-liquidity-setup-indicator";
import { generateFvgLiquidityDetector } from "@/lib/smc-modules/fvg-liquidity-detector";
import { generateObLiquidityDetector } from "@/lib/smc-modules/ob-liquidity-detector";
import { generateBbLiquidityDetector } from "@/lib/smc-modules/bb-liquidity-detector";
import { generateObFvgDetector } from "@/lib/smc-modules/ob-fvg-detector";
import { generateUnicornDetector } from "@/lib/smc-modules/unicorn-detector";
import { generateClassicSnrDetector } from "@/lib/smc-modules/classic-snr-detector";
import { generateGapSnrDetector } from "@/lib/smc-modules/gap-snr-detector";
import { generateStrongSnrDetector } from "@/lib/smc-modules/strong-snr-detector";
import { generateSnrc1Detector } from "@/lib/smc-modules/snrc1-detector";
import { generateBreakoutDetector } from "@/lib/smc-modules/breakout-detector";
import { generateRejectionDetector } from "@/lib/smc-modules/rejection-detector";
import { generateMissDetector } from "@/lib/smc-modules/miss-detector";
import { generateRssSrrDetector } from "@/lib/smc-modules/rss-srr-detector";
import { generateEngulfingDetector } from "@/lib/smc-modules/engulfing-detector";
import { generateStrongEngulfingDetector } from "@/lib/smc-modules/strong-engulfing-detector";
import { generateRbrDbdDetector } from "@/lib/smc-modules/rbr-dbd-detector";
import { generateMefDetector } from "@/lib/smc-modules/mef-detector";
import { generateQmMefDetector } from "@/lib/smc-modules/qm-mef-detector";
import { generateSnrc2Detector } from "@/lib/smc-modules/snrc2-detector";
import { generateSnrc2StateModule } from "@/lib/smc-modules/snrc2-state-module";

export type ResourceModuleCategoryId = "smc" | "snr" | "supply-demand";

export interface DownloadableModuleResource {
  id: string;
  filename: string;
  name: string;
  description: string;
  generate: () => string;
}

export interface DownloadableModuleCategory {
  id: ResourceModuleCategoryId;
  label: string;
  fullName: string;
  actionLabel: string;
  description: string;
  modules: DownloadableModuleResource[];
}

export const DOWNLOADABLE_MODULE_CATEGORIES: DownloadableModuleCategory[] = [
  {
    id: "smc",
    label: "SMC",
    fullName: "Smart Money Concepts",
    actionLabel: "Download SMC indicators",
    description:
      "Fair Value Gaps, Order Blocks, Breaker Blocks, liquidity, BOS, CHoCH, and related SMC chart tools.",
    modules: [
      {
        id: "fvg",
        filename: "FVG_Detector.mq5",
        name: "FVG Detector",
        description: "Marks Fair Value Gaps with mitigation, invalidation, and expiry handling.",
        generate: generateFvgDetector,
      },
      {
        id: "fvg-inversion",
        filename: "FVG_Inversion_Detector.mq5",
        name: "FVG Inversion Detector",
        description:
          "Shows polarity flips when price closes through an FVG and creates an inversion zone.",
        generate: generateFvgInversionDetector,
      },
      {
        id: "order-block",
        filename: "OB_Detector.mq5",
        name: "Order Block Detector",
        description: "Detects ATR-filtered Order Block zones with lifecycle tracking.",
        generate: generateObDetector,
      },
      {
        id: "breaker-block",
        filename: "BB_Detector.mq5",
        name: "Breaker Block Detector",
        description: "Detects Order Blocks that fail and flip into Breaker Blocks.",
        generate: generateBbDetector,
      },
      {
        id: "liquidity-sweep",
        filename: "LiqSweep_Detector.mq5",
        name: "Liquidity Sweep Detector",
        description: "Marks confirmed liquidity sweeps around swing highs and lows.",
        generate: generateLiqSweepDetector,
      },
      {
        id: "swing-structure",
        filename: "Swing_Structure_Detector.mq5",
        name: "Swing Structure Detector",
        description: "Marks confirmed pivot highs and lows for structure inspection.",
        generate: generateSwingStructureDetector,
      },
      {
        id: "bos",
        filename: "BOS_Detector.mq5",
        name: "BOS Detector",
        description: "Labels bullish and bearish Break of Structure events from confirmed swings.",
        generate: generateBosDetector,
      },
      {
        id: "choch",
        filename: "CHoCH_Detector.mq5",
        name: "CHoCH Detector",
        description: "Labels Change of Character events against the current structure direction.",
        generate: generateChochDetector,
      },
      {
        id: "liquidity-buildup",
        filename: "Liquidity_Buildup.mq5",
        name: "Liquidity Buildup",
        description: "Combines OB, BB, and FVG zones into a unified liquidity buildup view.",
        generate: generateZoneLiquiditySetupIndicator,
      },
      {
        id: "fvg-liquidity",
        filename: "FVG_Liquidity_Detector.mq5",
        name: "FVG Liquidity Detector",
        description: "Highlights liquidity building near Fair Value Gap edges before mitigation.",
        generate: generateFvgLiquidityDetector,
      },
      {
        id: "ob-liquidity",
        filename: "OB_Liquidity_Detector.mq5",
        name: "OB Liquidity Detector",
        description: "Highlights liquidity building near Order Block body edges.",
        generate: generateObLiquidityDetector,
      },
      {
        id: "bb-liquidity",
        filename: "BB_Liquidity_Detector.mq5",
        name: "BB Liquidity Detector",
        description: "Highlights liquidity building near Breaker Block body edges.",
        generate: generateBbLiquidityDetector,
      },
      {
        id: "ob-fvg",
        filename: "OB_FVG_Detector.mq5",
        name: "OB + FVG Detector",
        description: "Finds Fair Value Gaps where the first candle is also the Order Block.",
        generate: generateObFvgDetector,
      },
      {
        id: "unicorn",
        filename: "Unicorn_Detector.mq5",
        name: "Unicorn Detector",
        description: "Detects Breaker Block and FVG overlap pockets used in ICT Unicorn setups.",
        generate: generateUnicornDetector,
      },
    ],
  },
  {
    id: "snr",
    label: "SNR",
    fullName: "Support & Resistance",
    actionLabel: "Download SNR indicators",
    description:
      "Classic support and resistance, gap SNR, strong levels, breakout, rejection, miss, and sweep style tools.",
    modules: [
      {
        id: "classic-snr",
        filename: "Classic_SNR_Detector.mq5",
        name: "Classic SNR Detector",
        description: "Builds support and resistance levels from candle-pair reversals.",
        generate: generateClassicSnrDetector,
      },
      {
        id: "gap-snr",
        filename: "Gap_SNR_Detector.mq5",
        name: "Gap SNR Detector",
        description: "Builds momentum support and resistance from same-direction candle pairs.",
        generate: generateGapSnrDetector,
      },
      {
        id: "strong-snr",
        filename: "Strong_SNR_Detector.mq5",
        name: "Strong SNR Detector",
        description: "Filters SNR levels by displacement strength using ATR logic.",
        generate: generateStrongSnrDetector,
      },
      {
        id: "snrc1",
        filename: "SNRC1_Detector.mq5",
        name: "SNRC1 Detector",
        description: "Detects Strong SNR continuation setups with pullback zones.",
        generate: generateSnrc1Detector,
      },
      {
        id: "breakout",
        filename: "Breakout_Detector.mq5",
        name: "Breakout Detector",
        description: "Marks candle-close breakouts and RBS or SBR flip zones.",
        generate: generateBreakoutDetector,
      },
      {
        id: "rejection",
        filename: "Rejection_Detector.mq5",
        name: "Rejection Detector",
        description:
          "Marks wick rejection candles that pierce a level and close back on the origin side.",
        generate: generateRejectionDetector,
      },
      {
        id: "miss",
        filename: "Miss_Detector.mq5",
        name: "Miss Detector",
        description: "Marks swing turns that respect a nearby level without touching it.",
        generate: generateMissDetector,
      },
      {
        id: "rss-srr",
        filename: "RSS_SRR_Detector.mq5",
        name: "RSS / SRR Detector",
        description: "Detects resistance sweeping supports and support rallying resistances.",
        generate: generateRssSrrDetector,
      },
    ],
  },
  {
    id: "supply-demand",
    label: "S&D",
    fullName: "Supply & Demand",
    actionLabel: "Download S&D indicators",
    description:
      "Engulfing, supply and demand continuation, MEF, QM-MEF, RBR/DBD, and SNRC2 chart tools.",
    modules: [
      {
        id: "eng-detector",
        filename: "ENG_Detector.mq5",
        name: "Engulfing Detector",
        description: "Detects engulfing candles with visual labels and signal context.",
        generate: generateEngulfingDetector,
      },
      {
        id: "seg-detector",
        filename: "SEG_Detector.mq5",
        name: "Strong Engulfing Detector",
        description: "Detects stronger engulfing variants using displacement-style confirmation.",
        generate: generateStrongEngulfingDetector,
      },
      {
        id: "rbr-dbd-detector",
        filename: "RBR_DBD_Detector.mq5",
        name: "RBR / DBD Detector",
        description: "Marks rally-base-rally and drop-base-drop continuation structures.",
        generate: generateRbrDbdDetector,
      },
      {
        id: "mef-detector",
        filename: "MEF_Detector.mq5",
        name: "MEF Detector",
        description: "Detects market efficiency failure style supply and demand reactions.",
        generate: generateMefDetector,
      },
      {
        id: "qm-mef-detector",
        filename: "QM_MEF_Detector.mq5",
        name: "QM + MEF Detector",
        description: "Combines Quasimodo structure with MEF style reaction zones.",
        generate: generateQmMefDetector,
      },
      {
        id: "snrc2-detector",
        filename: "SNRC2_Detector.mq5",
        name: "SNRC2 Detector",
        description: "Detects SNR continuation 2 patterns for supply and demand workflows.",
        generate: generateSnrc2Detector,
      },
      {
        id: "snrc2-state",
        filename: "SNRC2_State_Module.mq5",
        name: "SNRC2 State Module",
        description:
          "State-module version of SNRC2 for deeper MT5 inspection and strategy testing.",
        generate: generateSnrc2StateModule,
      },
    ],
  },
];

export function getDownloadableModuleCategory(id: ResourceModuleCategoryId) {
  return (
    DOWNLOADABLE_MODULE_CATEGORIES.find((category) => category.id === id) ??
    DOWNLOADABLE_MODULE_CATEGORIES[0]
  );
}
