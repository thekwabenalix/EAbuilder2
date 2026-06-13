import type { BrainModuleType } from "../types/blueprint";
import { resolveModuleId } from "./resolve-module-id";

export type BrainRole = "direction" | "setup" | "execution";
export type ModuleImplementation = "state_machine" | "template" | "not_verified";
export type TickArgPolicy = "just_closed_bar" | "external_bias" | "lookback" | "none";

export interface ModuleSemanticEvent {
  id: string;
  roles: BrainRole[];
  queryFunctions: string[];
  meaning: string;
}

export interface ModuleContractParam {
  name: string;
  type: "int" | "double" | "bool" | "string";
  default: number | boolean | string;
  description: string;
}

export interface ModuleContract {
  id: BrainModuleType | "rsi_hd" | "ob_fvg" | "unicorn";
  label: string;
  implementation: ModuleImplementation;
  smType?: string;
  smPrefix?: string;
  tickArgPolicy: TickArgPolicy;
  supportedRoles: BrainRole[];
  semanticEvents: ModuleSemanticEvent[];
  params: ModuleContractParam[];
  aliases: string[];
  notes: string;
}

export const MODULE_CONTRACTS: Record<string, ModuleContract> = {
  ema: {
    id: "ema",
    label: "EMA",
    implementation: "state_machine",
    smType: "ema",
    smPrefix: "EMASM",
    tickArgPolicy: "external_bias",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "bias",
        roles: ["direction"],
        queryFunctions: ["EMASM_{id}_Bias()"],
        meaning: "Fast EMA above slow EMA is bullish; below is bearish.",
      },
      {
        id: "cross",
        roles: ["direction", "setup"],
        queryFunctions: [
          "EMASM_{id}_SetupActive()",
          "EMASM_{id}_ActiveDir()",
          "EMASM_{id}_ActiveSL()",
        ],
        meaning: "Fast/slow EMA cross arms or updates directional state.",
      },
      {
        id: "ema_retest",
        roles: ["setup"],
        queryFunctions: ["touchedFast", "touchedSlow", "gEmaIfvgTestTime_{id}"],
        meaning:
          "After an EMA cross, price touches the configured EMA target before later execution.",
      },
      {
        id: "retest_confirmed",
        roles: ["execution"],
        queryFunctions: [
          "EMASM_{id}_JustConfirmed()",
          "EMASM_{id}_ConfirmDir()",
          "EMASM_{id}_ConfirmSL()",
        ],
        meaning: "After cross and retest, a later candle closes outside the fast EMA.",
      },
    ],
    params: [
      { name: "fastPeriod", type: "int", default: 12, description: "Fast EMA period." },
      { name: "slowPeriod", type: "int", default: 48, description: "Slow EMA period." },
      { name: "retestPoints", type: "int", default: 0, description: "Touch tolerance in points." },
      {
        name: "requireCross",
        type: "bool",
        default: true,
        description: "Require a fresh cross before retest.",
      },
      {
        name: "repeatAfterConfirmation",
        type: "bool",
        default: false,
        description:
          "After a confirmed CTC entry, keep the current direction active and wait for a new retest instead of requiring a new cross.",
      },
      {
        name: "retestTarget",
        type: "string",
        default: "slow",
        description: "fast, slow, or either.",
      },
    ],
    aliases: ["ema", "exponential moving average", "moving average cross", "ema retest"],
    notes:
      "Use B4_MA/B4_MAval helpers for simple EMA alignment. Use EMASM only for cross-retest-confirm sequences.",
  },
  fvg_inversion: {
    id: "fvg_inversion",
    label: "Inversion FVG",
    implementation: "state_machine",
    smType: "fvg_inversion",
    smPrefix: "IFVGSM",
    tickArgPolicy: "just_closed_bar",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "formation",
        roles: ["setup", "execution"],
        queryFunctions: [
          "IFVGSM_{id}_BullJustInverted()",
          "IFVGSM_{id}_BearJustInverted()",
          "IFVGSM_{id}_BullInversionTime()",
          "IFVGSM_{id}_BearInversionTime()",
          "IFVGSM_{id}_BullInversionSL()",
          "IFVGSM_{id}_BearInversionSL()",
          "IFVGSM_{id}_LatestBullInversionTime()",
          "IFVGSM_{id}_LatestBearInversionTime()",
          "IFVGSM_{id}_LatestBullUL()",
          "IFVGSM_{id}_LatestBullLL()",
          "IFVGSM_{id}_LatestBearUL()",
          "IFVGSM_{id}_LatestBearLL()",
        ],
        meaning:
          "Old FVG is inverted by a close through its boundary; entry can fire on the next bar.",
      },
      {
        id: "retest",
        roles: ["setup", "execution"],
        queryFunctions: ["IFVGSM_{id}_BullJustRetested()", "IFVGSM_{id}_BearJustRetested()"],
        meaning: "Price wicks back into the IFVG zone after inversion.",
      },
      {
        id: "zone_rejection",
        roles: ["execution"],
        queryFunctions: [
          "IFVGSM_{id}_BullJustConfirmed()",
          "IFVGSM_{id}_BearJustConfirmed()",
          "IFVGSM_{id}_BullConfirmSL()",
          "IFVGSM_{id}_BearConfirmSL()",
          "IFVGSM_{id}_BullConfirmTime()",
          "IFVGSM_{id}_BearConfirmTime()",
        ],
        meaning: "After IFVG retest, close holds outside — SMC rejection confirm.",
      },
      {
        id: "confirmation",
        roles: ["execution"],
        queryFunctions: [
          "IFVGSM_{id}_BullJustConfirmed()",
          "IFVGSM_{id}_BearJustConfirmed()",
          "IFVGSM_{id}_BullConfirmSL()",
          "IFVGSM_{id}_BearConfirmSL()",
          "IFVGSM_{id}_BullConfirmTime()",
          "IFVGSM_{id}_BearConfirmTime()",
        ],
        meaning: "Alias for IFVG rejection / confirm entry.",
      },
      {
        id: "active_zone",
        roles: ["direction", "setup"],
        queryFunctions: [
          "IFVGSM_{id}_HasActiveBull()",
          "IFVGSM_{id}_HasActiveBear()",
          "IFVGSM_{id}_LatestBullUL()",
          "IFVGSM_{id}_LatestBullLL()",
          "IFVGSM_{id}_LatestBearUL()",
          "IFVGSM_{id}_LatestBearLL()",
          "IFVGSM_{id}_LatestBullInversionTime()",
          "IFVGSM_{id}_LatestBearInversionTime()",
          "IFVGSM_{id}_LatestBullFvgTime()",
          "IFVGSM_{id}_LatestBearFvgTime()",
        ],
        meaning: "An active bullish or bearish IFVG zone exists.",
      },
    ],
    params: [
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        description: "Bars before stale zones expire.",
      },
    ],
    aliases: ["ifvg", "inversion fvg", "inversion fair value gap", "inverted fvg"],
    notes:
      "For 'forms/becomes IFVG' use JustInverted and inversion SL/time. Use JustConfirmed only for explicit IFVG retest entries.",
  },
  fvg: {
    id: "fvg",
    label: "Fair Value Gap",
    implementation: "state_machine",
    smType: "fvg",
    smPrefix: "FVGSM",
    tickArgPolicy: "just_closed_bar",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "active_zone",
        roles: ["direction", "setup"],
        queryFunctions: ["FVGSM_{id}_HasActiveBull()", "FVGSM_{id}_HasActiveBear()"],
        meaning: "An active FVG zone in the bias direction sets or confirms the directional bias.",
      },
      {
        id: "retest",
        roles: ["setup", "execution"],
        queryFunctions: ["FVGSM_{id}_BullJustRetested()", "FVGSM_{id}_BearJustRetested()"],
        meaning: "Price wicks back into the FVG zone (first touch / retest).",
      },
      {
        id: "zone_rejection",
        roles: ["execution"],
        queryFunctions: [
          "FVGSM_{id}_BullJustConfirmed()",
          "FVGSM_{id}_BearJustConfirmed()",
          "FVGSM_{id}_BullConfirmSL()",
          "FVGSM_{id}_BearConfirmSL()",
        ],
        meaning: "After retest, close holds outside the zone — SMC rejection confirm.",
      },
    ],
    params: [
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        description: "Bars before stale gaps expire.",
      },
    ],
    aliases: ["fvg", "fair value gap", "imbalance", "gap"],
    notes: "Use for normal FVG zones. Use fvg_inversion when the trader says IFVG or inversion.",
  },
  order_block: {
    id: "order_block",
    label: "Order Block",
    implementation: "state_machine",
    smType: "ob",
    smPrefix: "OBSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "active_zone",
        roles: ["direction", "setup"],
        queryFunctions: [
          "OBSM_{id}_HasActiveBull()",
          "OBSM_{id}_HasActiveBear()",
          "OBSM_{id}_LatestBullLL()",
          "OBSM_{id}_LatestBearUL()",
        ],
        meaning: "An active order block establishes or confirms directional bias.",
      },
      {
        id: "retest",
        roles: ["setup", "execution"],
        queryFunctions: ["OBSM_{id}_BullJustRetested()", "OBSM_{id}_BearJustRetested()"],
        meaning: "Price wicks into the order block (mitigation / retest).",
      },
      {
        id: "zone_rejection",
        roles: ["execution"],
        queryFunctions: [
          "OBSM_{id}_BullJustConfirmed()",
          "OBSM_{id}_BearJustConfirmed()",
          "OBSM_{id}_BullConfirmSL()",
          "OBSM_{id}_BearConfirmSL()",
        ],
        meaning: "After OB retest, close holds outside the block — SMC rejection confirm.",
      },
    ],
    params: [
      { name: "lookback", type: "int", default: 20, description: "Bars scanned for order blocks." },
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        description: "Bars before stale zones expire.",
      },
    ],
    aliases: ["ob", "order block", "supply block", "demand block"],
    notes:
      "Maps supply/demand style zone language when the user describes OB displacement candles.",
  },
  ob_fvg: {
    id: "ob_fvg",
    label: "Order Block + FVG",
    implementation: "state_machine",
    smType: "ob_fvg",
    smPrefix: "OBFVGSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "confluence_zone",
        roles: ["direction", "setup"],
        queryFunctions: [
          "OBFVGSM_{id}_HasBullSetup()",
          "OBFVGSM_{id}_HasBearSetup()",
          "OBFVGSM_{id}_HasActiveBull()",
          "OBFVGSM_{id}_HasActiveBear()",
          "OBFVGSM_{id}_ActiveBullSL()",
          "OBFVGSM_{id}_ActiveBearSL()",
        ],
        meaning: "Order block and FVG confluence zone exists in the bias direction.",
      },
      {
        id: "entry",
        roles: ["execution"],
        queryFunctions: [
          "OBFVGSM_{id}_BullJustConfirmed()",
          "OBFVGSM_{id}_BearJustConfirmed()",
          "OBFVGSM_{id}_BullConfirmSL()",
          "OBFVGSM_{id}_BearConfirmSL()",
        ],
        meaning: "OB+FVG confluence entry has confirmed.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 50,
        description: "Bars scanned for OB/FVG confluence.",
      },
    ],
    aliases: ["ob fvg", "order block with fvg", "ob imbalance"],
    notes: "Use when trader explicitly requires OB and FVG confluence as one setup.",
  },
  unicorn: {
    id: "unicorn",
    label: "Unicorn (BB + FVG)",
    implementation: "state_machine",
    smType: "unicorn",
    smPrefix: "UNISMSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "overlap_active",
        roles: ["setup"],
        queryFunctions: [
          "UNISMSM_{id}_HasActiveBull()",
          "UNISMSM_{id}_HasActiveBear()",
          "UNISMSM_{id}_ActiveBullSL()",
          "UNISMSM_{id}_ActiveBearSL()",
        ],
        meaning: "Breaker block and FVG overlap pocket is live — awaiting retest.",
      },
      {
        id: "overlap_entry",
        roles: ["execution"],
        queryFunctions: [
          "UNISMSM_{id}_BullJustConfirmed()",
          "UNISMSM_{id}_BearJustConfirmed()",
          "UNISMSM_{id}_BullConfirmSL()",
          "UNISMSM_{id}_BearConfirmSL()",
        ],
        meaning: "Price tapped the overlap pocket — Unicorn entry confirmed.",
      },
    ],
    params: [
      { name: "lookback", type: "int", default: 500, description: "Bars scanned for OB/FVG/breaker patterns." },
      { name: "dispMult", type: "double", default: 1.5, description: "Displacement body >= N × ATR." },
      { name: "dispAtrPeriod", type: "int", default: 14, description: "ATR period for displacement filter." },
      { name: "obScanBack", type: "int", default: 5, description: "Bars back to find the OB candle." },
      { name: "pairWindow", type: "int", default: 15, description: "Max bars between breaker birth and FVG." },
      { name: "obExpiry", type: "int", default: 300, description: "Bars before unbroken OB expires." },
      { name: "uniExpiry", type: "int", default: 250, description: "Bars before matched Unicorn expires." },
    ],
    aliases: ["unicorn", "bb fvg", "breaker fvg", "ict unicorn", "breaker block fvg"],
    notes:
      "ICT Unicorn — NOT the same as OB+FVG. Requires a flipped breaker overlapping a same-direction FVG.",
  },
  bos: {
    id: "bos",
    label: "Break of Structure",
    implementation: "state_machine",
    smType: "bos",
    smPrefix: "BOSSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "bias",
        roles: ["direction"],
        queryFunctions: ["BOSSM_{id}_Trend()", "BOSSM_{id}_IsBull()", "BOSSM_{id}_IsBear()"],
        meaning: "Latest structural break sets persistent trend direction.",
      },
      {
        id: "break",
        roles: ["setup", "execution"],
        queryFunctions: ["BOSSM_{id}_BullJustBroke()", "BOSSM_{id}_BearJustBroke()"],
        meaning: "Price closed beyond a confirmed swing level.",
      },
    ],
    params: [
      { name: "swingLen", type: "int", default: 5, description: "Pivot strength." },
      { name: "lookback", type: "int", default: 50, description: "Bars scanned for pivots." },
    ],
    aliases: ["bos", "break of structure", "structure break", "higher high", "lower low"],
    notes:
      "Use for continuation structure. Use choch when the trader describes reversal/change of character.",
  },
  choch: {
    id: "choch",
    label: "Change of Character",
    implementation: "state_machine",
    smType: "choch",
    smPrefix: "BOSSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "bias_flip",
        roles: ["direction"],
        queryFunctions: ["BOSSM_{id}_Trend()", "BOSSM_{id}_IsBull()", "BOSSM_{id}_IsBear()"],
        meaning: "Structure changes character and flips directional bias.",
      },
      {
        id: "break",
        roles: ["setup", "execution"],
        queryFunctions: ["BOSSM_{id}_BullJustBroke()", "BOSSM_{id}_BearJustBroke()"],
        meaning: "CHoCH break event fired.",
      },
    ],
    params: [
      { name: "swingLen", type: "int", default: 5, description: "Pivot strength." },
      { name: "lookback", type: "int", default: 50, description: "Bars scanned for pivots." },
    ],
    aliases: ["choch", "change of character", "market structure shift", "mss"],
    notes: "Same BOS state machine family with reversal semantics.",
  },
  bos_choch: {
    id: "bos_choch",
    label: "BOS + CHoCH",
    implementation: "state_machine",
    smType: "bos_choch",
    smPrefix: "BOSSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "structure_event",
        roles: ["direction", "setup", "execution"],
        queryFunctions: [
          "BOSSM_{id}_Trend()",
          "BOSSM_{id}_IsBull()",
          "BOSSM_{id}_IsBear()",
          "BOSSM_{id}_BullJustBroke()",
          "BOSSM_{id}_BearJustBroke()",
        ],
        meaning: "Combined continuation and reversal structure events.",
      },
    ],
    params: [
      { name: "swingLen", type: "int", default: 5, description: "Pivot strength." },
      { name: "lookback", type: "int", default: 50, description: "Bars scanned for pivots." },
    ],
    aliases: ["bos choch", "structure", "market structure"],
    notes: "Use when the trader wants both continuation and reversal structure handling.",
  },
  swing_structure: {
    id: "swing_structure",
    label: "Swing Structure",
    implementation: "state_machine",
    smType: "swing_structure",
    smPrefix: "SWINGSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["direction", "setup"],
    semanticEvents: [
      {
        id: "swing_bias",
        roles: ["direction"],
        queryFunctions: ["SWINGSM_{id}_IsBull()", "SWINGSM_{id}_IsBear()"],
        meaning: "HH/HL bull bias or LH/LL bear bias from confirmed pivots.",
      },
      {
        id: "swing_level",
        roles: ["setup", "direction"],
        queryFunctions: [
          "SWINGSM_{id}_BullJustConfirmed()",
          "SWINGSM_{id}_BearJustConfirmed()",
          "SWINGSM_{id}_ActiveBullSL()",
          "SWINGSM_{id}_ActiveBearSL()",
        ],
        meaning: "New swing pivot confirmed — last swing low/high as SL reference.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 500,
        description: "Bars scanned for swing pivots.",
      },
      {
        name: "swingLeft",
        type: "int",
        default: 3,
        description: "Bars on the older side to confirm a pivot.",
      },
      {
        name: "swingRight",
        type: "int",
        default: 3,
        description: "Bars on the newer side to confirm a pivot.",
      },
    ],
    aliases: ["swing structure", "swing high", "swing low", "higher highs", "lower lows"],
    notes: "Confirmed pivots only — HH/HL bull or LH/LL bear; not BOS/CHoCH.",
  },
  liqsweep: {
    id: "liqsweep",
    label: "Liquidity Sweep",
    implementation: "state_machine",
    smType: "liqsweep",
    smPrefix: "LSSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "sweep",
        roles: ["setup", "execution"],
        queryFunctions: [
          "LSSM_{id}_BullJustConfirmed()",
          "LSSM_{id}_BearJustConfirmed()",
          "LSSM_{id}_BullConfirmSL()",
          "LSSM_{id}_BearConfirmSL()",
        ],
        meaning: "Price swept liquidity beyond a swing/high-low and rejected.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 50,
        description: "Bars scanned for liquidity levels.",
      },
    ],
    aliases: ["liquidity sweep", "stop hunt", "sweep highs", "sweep lows"],
    notes: "Use for stop-hunt/sweep language, often before BOS or IFVG entry.",
  },
  snr: {
    id: "snr",
    label: "Support and Resistance",
    implementation: "state_machine",
    smType: "snr",
    smPrefix: "SNRSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "level_touch",
        roles: ["setup", "execution"],
        queryFunctions: [
          "SNRSM_{id}_HasActiveBull()",
          "SNRSM_{id}_HasActiveBear()",
          "SNRSM_{id}_BullJustConfirmed()",
          "SNRSM_{id}_BearJustConfirmed()",
          "SNRSM_{id}_BullConfirmSL()",
          "SNRSM_{id}_BearConfirmSL()",
        ],
        meaning: "Price interacted with a support/resistance level.",
      },
    ],
    params: [
      { name: "lookback", type: "int", default: 50, description: "Bars scanned for levels." },
    ],
    aliases: ["support", "resistance", "snr", "s/r", "horizontal level"],
    notes: "Use for classic support/resistance levels.",
  },
  gap_snr: {
    id: "gap_snr",
    label: "Gap S/R",
    implementation: "state_machine",
    smType: "gap_snr",
    smPrefix: "GSNRSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "gap_level_touch",
        roles: ["setup", "execution"],
        queryFunctions: [
          "GSNRSM_{id}_HasActiveBull()",
          "GSNRSM_{id}_HasActiveBear()",
          "GSNRSM_{id}_BullJustConfirmed()",
          "GSNRSM_{id}_BearJustConfirmed()",
          "GSNRSM_{id}_BullConfirmSL()",
          "GSNRSM_{id}_BearConfirmSL()",
        ],
        meaning: "Price interacted with a support/resistance level derived from a gap edge.",
      },
    ],
    params: [
      { name: "lookback", type: "int", default: 50, description: "Bars scanned for gap levels." },
    ],
    aliases: ["gap support", "gap resistance", "gap snr", "gap level"],
    notes: "Use for support/resistance created by gap edges.",
  },
  rejection: {
    id: "rejection",
    label: "Rejection",
    implementation: "state_machine",
    smType: "rejection",
    smPrefix: "REJSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["execution"],
    semanticEvents: [
      {
        id: "rejection",
        roles: ["execution"],
        queryFunctions: [
          "REJSM_{id}_BullJustConfirmed()",
          "REJSM_{id}_BearJustConfirmed()",
          "REJSM_{id}_BullConfirmSL()",
          "REJSM_{id}_BearConfirmSL()",
        ],
        meaning: "A candle rejected a level with a wick/body pattern.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 20,
        description: "Bars scanned for rejection context.",
      },
    ],
    aliases: ["rejection", "wick rejection", "rejects level"],
    notes: "Execution trigger for level rejection language.",
  },
  miss: {
    id: "miss",
    label: "Missed Level",
    implementation: "state_machine",
    smType: "miss",
    smPrefix: "MISSSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "miss",
        roles: ["setup", "execution"],
        queryFunctions: [
          "MISSSM_{id}_HasActiveBull()",
          "MISSSM_{id}_HasActiveBear()",
          "MISSSM_{id}_BullJustConfirmed()",
          "MISSSM_{id}_BearJustConfirmed()",
          "MISSSM_{id}_BullConfirmSL()",
          "MISSSM_{id}_BearConfirmSL()",
        ],
        meaning: "Price narrowly missed a level, suggesting liquidity behavior.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 20,
        description: "Bars scanned for missed levels.",
      },
    ],
    aliases: ["miss", "missed level", "failed to reach level"],
    notes: "Reactive S/R liquidity behavior.",
  },
  zone_liq: {
    id: "zone_liq",
    label: "Liquidity Buildup",
    implementation: "state_machine",
    smType: "zone_liq",
    smPrefix: "ZLSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "zone_armed",
        roles: ["setup"],
        queryFunctions: [
          "ZLSM_{id}_HasActiveBull()",
          "ZLSM_{id}_HasActiveBear()",
          "ZLSM_{id}_ActiveBullSL()",
          "ZLSM_{id}_ActiveBearSL()",
        ],
        meaning: "OB/BB/FVG zone with liquidity built — wick approached the edge without entering.",
      },
      {
        id: "zone_confirmed",
        roles: ["setup", "execution"],
        queryFunctions: [
          "ZLSM_{id}_BullJustConfirmed()",
          "ZLSM_{id}_BearJustConfirmed()",
          "ZLSM_{id}_BullConfirmSL()",
          "ZLSM_{id}_BearConfirmSL()",
        ],
        meaning: "New liquidity buildup confirmed this bar (closest wick within proximity).",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 200,
        description: "Bars scanned for OB/BB/FVG zones.",
      },
      {
        name: "minLiqBars",
        type: "int",
        default: 1,
        description: "Minimum approach bars before buildup counts as armed.",
      },
      {
        name: "nearATR",
        type: "double",
        default: 0.2,
        description: "Wick proximity to zone edge as ATR fraction.",
      },
    ],
    aliases: [
      "liquidity buildup",
      "liquidity build up",
      "liquidity build-up",
      "zone liquidity",
      "fvg liquidity buildup",
      "ob liquidity buildup",
      "bb liquidity buildup",
    ],
    notes: "Combined OB + BB + FVG liquidity buildup — wick near edge without entering.",
  },
  snrc2: {
    id: "snrc2",
    label: "SNRC2",
    implementation: "state_machine",
    smType: "snrc2",
    smPrefix: "SNRC2SM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "pattern_active",
        roles: ["setup"],
        queryFunctions: [
          "SNRC2SM_{id}_HasActiveBull()",
          "SNRC2SM_{id}_HasActiveBear()",
          "SNRC2SM_{id}_ActiveBullSL()",
          "SNRC2SM_{id}_ActiveBearSL()",
        ],
        meaning: "Live SNRC2 continuation — entry level active until tapped or SL invalidation.",
      },
      {
        id: "pattern_confirmed",
        roles: ["setup", "execution"],
        queryFunctions: [
          "SNRC2SM_{id}_BullJustConfirmed()",
          "SNRC2SM_{id}_BearJustConfirmed()",
          "SNRC2SM_{id}_BullConfirmSL()",
          "SNRC2SM_{id}_BearConfirmSL()",
        ],
        meaning: "SNRC2 pattern confirmed this bar after manipulation and continuation pivot.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 400,
        description: "Bars scanned for pivot structure.",
      },
      {
        name: "swingStrength",
        type: "int",
        default: 2,
        description: "Fractal strength (bars each side of pivot).",
      },
      {
        name: "htfTf",
        type: "string",
        default: "H4",
        description: "Higher timeframe that must show engulfing before the pattern.",
      },
      {
        name: "htfLookback",
        type: "int",
        default: 4,
        description: "HTF bars before pattern start to find qualifying engulfing.",
      },
      {
        name: "expiryBars",
        type: "int",
        default: 250,
        description: "Bars until an unfilled SNRC2 setup expires.",
      },
    ],
    aliases: [
      "snrc2",
      "support resistance continuation",
      "support/resistance continuation 2",
      "classic snr continuation",
    ],
    notes: "Continuation after Classic SNR break with manipulation pullback and HTF engulfing filter.",
  },
  breaker_block: {
    id: "breaker_block",
    label: "Breaker Block",
    implementation: "state_machine",
    smType: "breaker_block",
    smPrefix: "BBSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "zone_active",
        roles: ["setup"],
        queryFunctions: [
          "BBSM_{id}_HasActiveBull()",
          "BBSM_{id}_HasActiveBear()",
          "BBSM_{id}_ActiveBullSL()",
          "BBSM_{id}_ActiveBearSL()",
        ],
        meaning: "Live breaker block zone after failed OB — awaiting retest.",
      },
      {
        id: "bb_confirmed",
        roles: ["setup", "execution"],
        queryFunctions: [
          "BBSM_{id}_BullJustConfirmed()",
          "BBSM_{id}_BearJustConfirmed()",
          "BBSM_{id}_BullConfirmSL()",
          "BBSM_{id}_BearConfirmSL()",
        ],
        meaning: "Breaker block retested and confirmed this bar (close beyond zone edge).",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 500,
        description: "Bars scanned for OB displacement and BB lifecycle.",
      },
      {
        name: "dispMult",
        type: "double",
        default: 1.5,
        description: "ATR multiplier for displacement body filter.",
      },
      {
        name: "obLookback",
        type: "int",
        default: 5,
        description: "Bars before displacement to find the OB candle.",
      },
    ],
    aliases: [
      "breaker block",
      "smc breaker block",
      "smc bb",
      "failed order block",
      "ob flip",
    ],
    notes: "SMC Breaker Block — failed OB polarity flip. Not Bollinger Bands (bb).",
  },
  rss_srr: {
    id: "rss_srr",
    label: "RSS / SRR",
    implementation: "state_machine",
    smType: "rss_srr",
    smPrefix: "RSSSRRSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "srr_active",
        roles: ["setup"],
        queryFunctions: [
          "RSSSRRSM_{id}_HasActiveBull()",
          "RSSSRRSM_{id}_ActiveBullSL()",
        ],
        meaning: "Live SRR — driving Support swept ≥ minBreaks resistances, not invalidated.",
      },
      {
        id: "rss_active",
        roles: ["setup"],
        queryFunctions: [
          "RSSSRRSM_{id}_HasActiveBear()",
          "RSSSRRSM_{id}_ActiveBearSL()",
        ],
        meaning: "Live RSS — driving Resistance swept ≥ minBreaks supports, not invalidated.",
      },
      {
        id: "srr_confirmed",
        roles: ["setup", "execution"],
        queryFunctions: [
          "RSSSRRSM_{id}_BullJustConfirmed()",
          "RSSSRRSM_{id}_BullConfirmSL()",
        ],
        meaning: "SRR fired this bar — Support drove minBreaks resistance close-breaks.",
      },
      {
        id: "rss_confirmed",
        roles: ["setup", "execution"],
        queryFunctions: [
          "RSSSRRSM_{id}_BearJustConfirmed()",
          "RSSSRRSM_{id}_BearConfirmSL()",
        ],
        meaning: "RSS fired this bar — Resistance drove minBreaks support close-breaks.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 500,
        description: "Bars scanned for Classic SNR levels and sweeps.",
      },
      {
        name: "minBreaks",
        type: "int",
        default: 2,
        description: "Minimum opposite-side close-breaks before RSS/SRR fires.",
      },
      {
        name: "expiryBars",
        type: "int",
        default: 150,
        description: "Bars until an untouched level expires.",
      },
    ],
    aliases: ["rss", "srr", "rss srr", "repeated support sweep", "repeated resistance sweep"],
    notes: "Classic SNR sweep counter — RSS (sell) / SRR (buy).",
  },
  mef: {
    id: "mef",
    label: "MEF",
    implementation: "state_machine",
    smType: "mef",
    smPrefix: "MEFSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "pattern_active",
        roles: ["setup"],
        queryFunctions: [
          "MEFSM_{id}_HasActiveBull()",
          "MEFSM_{id}_HasActiveBear()",
          "MEFSM_{id}_ActiveBullSL()",
          "MEFSM_{id}_ActiveBearSL()",
        ],
        meaning: "Live MEF — engulfing confluence active until expiry.",
      },
      {
        id: "pattern_confirmed",
        roles: ["setup", "execution"],
        queryFunctions: [
          "MEFSM_{id}_BullJustConfirmed()",
          "MEFSM_{id}_BearJustConfirmed()",
          "MEFSM_{id}_BullConfirmSL()",
          "MEFSM_{id}_BearConfirmSL()",
        ],
        meaning: "MEF confirmed this bar — strong engulfing + Gap SNR + RBR/DBD inside.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 300,
        description: "Main-TF bars scanned for engulfing confluence.",
      },
      {
        name: "expiryBars",
        type: "int",
        default: 150,
        description: "Main-TF bars until an unfilled MEF mark expires.",
      },
      {
        name: "gapTf",
        type: "string",
        default: "H1",
        description: "Gap SNR timeframe (1 step below main TF if omitted).",
      },
      {
        name: "baseTf",
        type: "string",
        default: "M30",
        description: "RBR/DBD timeframe (2 steps below main TF if omitted).",
      },
      {
        name: "impulseRatio",
        type: "double",
        default: 0.5,
        description: "RBR/DBD leg candle body/range minimum.",
      },
      {
        name: "baseMaxRatio",
        type: "double",
        default: 0.5,
        description: "RBR/DBD base candle body/range maximum.",
      },
      {
        name: "maxBaseCandles",
        type: "int",
        default: 6,
        description: "Maximum candles in an RBR/DBD base.",
      },
      {
        name: "legBaseMult",
        type: "double",
        default: 1.3,
        description: "Leg range must exceed avg base range × this multiplier.",
      },
    ],
    aliases: [
      "mef",
      "manipulation entry formula",
      "mef candle",
      "multi timeframe engulfing",
    ],
    notes: "Engulfing (main TF) + Gap SNR (1 TF lower) + RBR/DBD (2 TF lower) inside the engulf window.",
  },
  qm_mef: {
    id: "qm_mef",
    label: "QM MEF",
    implementation: "state_machine",
    smType: "qm_mef",
    smPrefix: "QMMEFSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "pattern_active",
        roles: ["setup"],
        queryFunctions: [
          "QMMEFSM_{id}_HasActiveBull()",
          "QMMEFSM_{id}_HasActiveBear()",
          "QMMEFSM_{id}_ActiveBullSL()",
          "QMMEFSM_{id}_ActiveBearSL()",
        ],
        meaning: "Live QM_MEF awaiting left-shoulder retest — not touched, not invalidated.",
      },
      {
        id: "ls_touched",
        roles: ["setup", "execution"],
        queryFunctions: [
          "QMMEFSM_{id}_BullJustConfirmed()",
          "QMMEFSM_{id}_BearJustConfirmed()",
          "QMMEFSM_{id}_BullConfirmSL()",
          "QMMEFSM_{id}_BearConfirmSL()",
        ],
        meaning: "Left shoulder touched this bar — right-shoulder entry trigger.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 300,
        description: "HTF bars scanned for engulfing-born QM patterns.",
      },
      {
        name: "expiryBars",
        type: "int",
        default: 150,
        description: "HTF bars until an unfilled QM_MEF expires.",
      },
      {
        name: "qmTf",
        type: "string",
        default: "M15",
        description: "LTF Quasimodo timeframe (3 steps below main TF if omitted).",
      },
      {
        name: "confTf",
        type: "string",
        default: "M5",
        description: "Confluence timeframe for Gap SNR / RBR / DBD near left shoulder.",
      },
      {
        name: "confTolFrac",
        type: "double",
        default: 0.3,
        description: "Left-shoulder proximity tolerance as fraction of QM range.",
      },
      {
        name: "impulseRatio",
        type: "double",
        default: 0.5,
        description: "RBR/DBD leg candle body/range minimum.",
      },
      {
        name: "baseMaxRatio",
        type: "double",
        default: 0.5,
        description: "RBR/DBD base candle body/range maximum.",
      },
      {
        name: "maxBaseCandles",
        type: "int",
        default: 6,
        description: "Maximum candles in an RBR/DBD base.",
      },
      {
        name: "legBaseMult",
        type: "double",
        default: 1.3,
        description: "Leg range must exceed avg base range × this multiplier.",
      },
    ],
    aliases: [
      "qm mef",
      "qm_mef",
      "quasimodo mef",
      "quasimodo manipulation entry",
    ],
    notes: "HTF engulfing-born Quasimodo — entry at left shoulder, SL beyond head, optional confluence.",
  },
  rbr_dbd: {
    id: "rbr_dbd",
    label: "RBR / DBD",
    implementation: "state_machine",
    smType: "rbr_dbd",
    smPrefix: "RBRDBDSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "demand_active",
        roles: ["setup"],
        queryFunctions: [
          "RBRDBDSM_{id}_HasActiveBull()",
          "RBRDBDSM_{id}_ActiveBullSL()",
        ],
        meaning: "Live RBR demand zone — base not traded through, not expired.",
      },
      {
        id: "supply_active",
        roles: ["setup"],
        queryFunctions: [
          "RBRDBDSM_{id}_HasActiveBear()",
          "RBRDBDSM_{id}_ActiveBearSL()",
        ],
        meaning: "Live DBD supply zone — base not traded through, not expired.",
      },
      {
        id: "rbr_confirmed",
        roles: ["setup", "execution"],
        queryFunctions: [
          "RBRDBDSM_{id}_BullJustConfirmed()",
          "RBRDBDSM_{id}_BullConfirmSL()",
        ],
        meaning: "RBR demand zone confirmed this bar — leg-out broke above base.",
      },
      {
        id: "dbd_confirmed",
        roles: ["setup", "execution"],
        queryFunctions: [
          "RBRDBDSM_{id}_BearJustConfirmed()",
          "RBRDBDSM_{id}_BearConfirmSL()",
        ],
        meaning: "DBD supply zone confirmed this bar — leg-out broke below base.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 400,
        description: "Bars scanned for RBR/DBD base patterns.",
      },
      {
        name: "expiryBars",
        type: "int",
        default: 200,
        description: "Bars until an untested zone expires.",
      },
      {
        name: "impulseRatio",
        type: "double",
        default: 0.5,
        description: "Leg candle body/range minimum.",
      },
      {
        name: "baseMaxRatio",
        type: "double",
        default: 0.5,
        description: "Base candle body/range maximum.",
      },
      {
        name: "maxBaseCandles",
        type: "int",
        default: 6,
        description: "Maximum candles in a base.",
      },
      {
        name: "legBaseMult",
        type: "double",
        default: 1.3,
        description: "Leg range must exceed avg base range × this multiplier.",
      },
    ],
    aliases: [
      "rbr",
      "dbd",
      "rbr dbd",
      "rally base rally",
      "drop base drop",
      "supply demand zone",
    ],
    notes: "RBR demand / DBD supply — base zone invalidates on close through the zone.",
  },
  breakout: {
    id: "breakout",
    label: "Breakout",
    implementation: "state_machine",
    smType: "breakout",
    smPrefix: "BRKSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "breakout",
        roles: ["setup", "execution"],
        queryFunctions: [
          "BRKSM_{id}_HasActiveBull()",
          "BRKSM_{id}_HasActiveBear()",
          "BRKSM_{id}_BullJustConfirmed()",
          "BRKSM_{id}_BearJustConfirmed()",
          "BRKSM_{id}_BullConfirmSL()",
          "BRKSM_{id}_BearConfirmSL()",
        ],
        meaning: "Price broke beyond a range or level.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 50,
        description: "Bars scanned for breakout range.",
      },
    ],
    aliases: ["breakout", "range break", "break high", "break low"],
    notes: "Use for generic breakout strategies not specifically BOS.",
  },
  rsi_hd: {
    id: "rsi_hd",
    label: "RSI Hidden Divergence",
    implementation: "state_machine",
    smType: "rsi_hd",
    smPrefix: "RSIHDSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "hidden_divergence",
        roles: ["setup", "execution"],
        queryFunctions: [
          "RSIHDSM_{id}_HasActiveBull()",
          "RSIHDSM_{id}_HasActiveBear()",
          "RSIHDSM_{id}_ActiveBullSL()",
          "RSIHDSM_{id}_ActiveBearSL()",
          "RSIHDSM_{id}_BullJustDiverged()",
          "RSIHDSM_{id}_BearJustDiverged()",
          "RSIHDSM_{id}_BullJustConfirmed()",
          "RSIHDSM_{id}_BearJustConfirmed()",
          "RSIHDSM_{id}_BullConfirmSL()",
          "RSIHDSM_{id}_BearConfirmSL()",
        ],
        meaning: "RSI hidden divergence continuation event.",
      },
    ],
    params: [
      { name: "rsiPeriod", type: "int", default: 14, description: "RSI period." },
      { name: "lookback", type: "int", default: 50, description: "Bars scanned for divergence." },
    ],
    aliases: ["rsi hidden divergence", "hidden divergence", "rsi divergence"],
    notes: "Use for continuation divergence, especially trend pullback entries.",
  },
  bb: {
    id: "bb",
    label: "Bollinger Bands",
    implementation: "state_machine",
    smType: "bb",
    smPrefix: "BOLLSM",
    tickArgPolicy: "just_closed_bar",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "band_touch",
        roles: ["setup", "execution"],
        queryFunctions: [
          "BOLLSM_{id}_BullJustConfirmed()",
          "BOLLSM_{id}_BearJustConfirmed()",
          "BOLLSM_{id}_BullConfirmSL()",
          "BOLLSM_{id}_BearConfirmSL()",
        ],
        meaning: "Price touches and rejects a Bollinger Band (lower bull / upper bear).",
      },
      {
        id: "band_breakout",
        roles: ["direction", "setup", "execution"],
        queryFunctions: [
          "BOLLSM_{id}_IsBull()",
          "BOLLSM_{id}_IsBear()",
          "BOLLSM_{id}_HasActiveBull()",
          "BOLLSM_{id}_HasActiveBear()",
          "BOLLSM_{id}_BullJustConfirmed()",
          "BOLLSM_{id}_BearJustConfirmed()",
        ],
        meaning: "Price closes outside a Bollinger Band or holds midline bias.",
      },
    ],
    params: [
      { name: "period", type: "int", default: 20, description: "Bollinger period." },
      { name: "deviation", type: "double", default: 2, description: "Standard deviation multiplier." },
      {
        name: "mode",
        type: "string",
        default: "touch",
        description: "touch | breakout | midline — signal interpretation.",
      },
    ],
    aliases: ["bollinger", "bollinger bands", "upper band", "lower band"],
    notes: "Prefix BOLLSM — distinct from SMC Breaker Block BBSM.",
  },
  engulfing: {
    id: "engulfing",
    label: "Engulfing / Engulfing Failed",
    implementation: "state_machine",
    smType: "engulfing",
    smPrefix: "EGSM",
    tickArgPolicy: "lookback",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "eg_zone_active",
        roles: ["direction", "setup"],
        queryFunctions: ["EGSM_{id}_HasActiveBull()", "EGSM_{id}_HasActiveBear()"],
        meaning: "A live EG or EF zone exists in the given direction.",
      },
      {
        id: "eg_confirmed",
        roles: ["setup", "execution"],
        queryFunctions: [
          "EGSM_{id}_BullJustConfirmed()",
          "EGSM_{id}_BearJustConfirmed()",
          "EGSM_{id}_BullConfirmSL()",
          "EGSM_{id}_BearConfirmSL()",
        ],
        meaning: "Price retested the EG/EF zone and closed back outside — zone held. Entry signal.",
      },
      {
        id: "ef_formed",
        roles: ["direction", "setup"],
        queryFunctions: ["EGSM_{id}_HasActiveBull()", "EGSM_{id}_HasActiveBear()"],
        meaning:
          "An EG zone was violated and flipped direction — now an EF zone in the opposite direction.",
      },
    ],
    params: [
      {
        name: "scanBack",
        type: "int",
        default: 3,
        description: "Bars scanned each tick for new EG patterns.",
      },
      {
        name: "expiryBars",
        type: "int",
        default: 100,
        description: "Bars until an untested zone expires.",
      },
    ],
    aliases: [
      "engulfing",
      "EG",
      "EF",
      "engulfing failed",
      "bullish engulfing",
      "bearish engulfing",
      "MES",
      "Malaysian engulfing",
    ],
    notes:
      "EG = wick-defined zone (like OB but marked from C1 full wick range). EF = a failed EG — price closed through the zone, which then flips direction. Both share one SM instance. EF is NOT a Breaker Block; it requires no BOS context.",
  },
  pin_bar: {
    id: "pin_bar",
    label: "Pin Bar",
    implementation: "state_machine",
    smType: "pin_bar",
    smPrefix: "PINSM",
    tickArgPolicy: "just_closed_bar",
    supportedRoles: ["execution"],
    semanticEvents: [
      {
        id: "pin_bar",
        roles: ["execution"],
        queryFunctions: [
          "PINSM_{id}_BullJustConfirmed()",
          "PINSM_{id}_BearJustConfirmed()",
          "PINSM_{id}_BullConfirmSL()",
          "PINSM_{id}_BearConfirmSL()",
          "PINSM_{id}_HasActiveBull()",
          "PINSM_{id}_HasActiveBear()",
        ],
        meaning: "Pin bar / hammer / shooting-star rejection candle on the just-closed bar.",
      },
    ],
    params: [
      {
        name: "wickRatio",
        type: "double",
        default: 0.6,
        description: "Wick must be >= N × candle range.",
      },
      {
        name: "bodyMaxRatio",
        type: "double",
        default: 0.35,
        description: "Body must be <= N × candle range.",
      },
    ],
    aliases: ["pin bar", "hammer", "shooting star", "long wick", "rejection candle"],
    notes: "Point-in-time execution trigger — fires on the just-closed bar.",
  },
};

export function getModuleContract(moduleId: string): ModuleContract | undefined {
  return MODULE_CONTRACTS[resolveModuleId(moduleId)];
}

export function moduleSupportsEvent(moduleId: string, eventId: string, role?: BrainRole): boolean {
  const contract = getModuleContract(moduleId);
  if (!contract) return false;
  return contract.semanticEvents.some(
    (event) => event.id === eventId && (!role || event.roles.includes(role)),
  );
}

export function getContractsBySmPrefix(prefix: string): ModuleContract[] {
  return Object.values(MODULE_CONTRACTS).filter((contract) => contract.smPrefix === prefix);
}

function queryFunctionSuffix(queryFunction: string): string | null {
  const match = queryFunction.match(/^[A-Z]+SM_\{id\}_(\w+)\(\)$/);
  return match?.[1] ?? null;
}

export function moduleContractAllowsSmFunction(prefix: string, fnName: string): boolean {
  const contracts = getContractsBySmPrefix(prefix);
  if (!contracts.length) return false;

  const suffix = fnName.replace(new RegExp(`^${prefix}_[A-Za-z0-9]+_`), "").replace(/\($/, "");
  if (suffix === "Tick" || suffix === "Reset") return true;

  return contracts.some((contract) =>
    contract.semanticEvents.some((event) =>
      event.queryFunctions.some((query) => queryFunctionSuffix(query) === suffix),
    ),
  );
}

export function buildCompactModuleContractContext(): string {
  const lines = [
    "MODULE CONTRACT REGISTRY - obey these verified capabilities.",
    "Use only listed semantic events and query functions for module wiring.",
    "Replace {id} with the configured state-machine id/timeframe label.",
    "",
  ];

  for (const contract of Object.values(MODULE_CONTRACTS)) {
    lines.push(`[${contract.id}] ${contract.label}`);
    lines.push(
      `  Implementation: ${contract.implementation}${contract.smPrefix ? ` (${contract.smPrefix})` : ""}`,
    );
    lines.push(`  Roles: ${contract.supportedRoles.join(", ")}`);
    lines.push(`  Tick policy: ${contract.tickArgPolicy}`);
    if (contract.params.length) {
      lines.push(`  Params: ${contract.params.map((p) => `${p.name}=${p.default}`).join(", ")}`);
    }
    for (const event of contract.semanticEvents) {
      lines.push(`  Event ${event.id} -> roles ${event.roles.join("/")}`);
      lines.push(`    Queries: ${event.queryFunctions.join(", ")}`);
    }
    lines.push(`  Note: ${contract.notes}`);
    lines.push("");
  }

  return lines.join("\n");
}
