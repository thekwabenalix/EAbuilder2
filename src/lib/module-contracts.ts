import type { BrainModuleType } from "../types/blueprint";

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
  id: BrainModuleType | "rsi_hd" | "ob_fvg";
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
        queryFunctions: ["EMASM_{id}_SetupActive()", "EMASM_{id}_ActiveDir()"],
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
        ],
        meaning:
          "Old FVG is inverted by a close through its boundary; entry can fire on the next bar.",
      },
      {
        id: "retest",
        roles: ["execution"],
        queryFunctions: [
          "IFVGSM_{id}_BullJustConfirmed()",
          "IFVGSM_{id}_BearJustConfirmed()",
          "IFVGSM_{id}_BullConfirmTime()",
          "IFVGSM_{id}_BearConfirmTime()",
        ],
        meaning: "Price returns to the born IFVG zone and confirms after the inversion.",
      },
      {
        id: "confirmation",
        roles: ["execution"],
        queryFunctions: ["IFVGSM_{id}_BullJustConfirmed()", "IFVGSM_{id}_BearJustConfirmed()"],
        meaning: "Alias for explicit IFVG retest confirmation entry.",
      },
      {
        id: "active_zone",
        roles: ["direction", "setup"],
        queryFunctions: ["IFVGSM_{id}_HasActiveBull()", "IFVGSM_{id}_HasActiveBear()"],
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
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "active_zone",
        roles: ["setup"],
        queryFunctions: ["FVGSM_{id}_HasActiveBull()", "FVGSM_{id}_HasActiveBear()"],
        meaning: "A valid bullish or bearish FVG zone is active.",
      },
      {
        id: "confirmation",
        roles: ["execution"],
        queryFunctions: ["FVGSM_{id}_BullJustConfirmed()", "FVGSM_{id}_BearJustConfirmed()"],
        meaning: "FVG entry confirmation has fired.",
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
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "active_zone",
        roles: ["setup"],
        queryFunctions: [
          "OBSM_{id}_HasActiveBull()",
          "OBSM_{id}_HasActiveBear()",
          "OBSM_{id}_LatestBullLL()",
          "OBSM_{id}_LatestBearUL()",
        ],
        meaning: "A bullish or bearish order block is active.",
      },
      {
        id: "mitigation",
        roles: ["execution"],
        queryFunctions: [
          "OBSM_{id}_BullJustConfirmed()",
          "OBSM_{id}_BearJustConfirmed()",
          "OBSM_{id}_BullConfirmSL()",
          "OBSM_{id}_BearConfirmSL()",
        ],
        meaning: "Price mitigated/touched the order block.",
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
    supportedRoles: ["setup", "execution"],
    semanticEvents: [
      {
        id: "confluence_zone",
        roles: ["setup"],
        queryFunctions: [
          "OBFVGSM_{id}_HasBullSetup()",
          "OBFVGSM_{id}_HasBearSetup()",
          "OBFVGSM_{id}_HasActiveBull()",
          "OBFVGSM_{id}_HasActiveBear()",
          "OBFVGSM_{id}_ActiveBullSL()",
          "OBFVGSM_{id}_ActiveBearSL()",
        ],
        meaning: "Order block and FVG confluence zone exists.",
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
    aliases: ["ob fvg", "order block with fvg", "unicorn", "ob imbalance"],
    notes: "Use when trader explicitly requires OB and FVG confluence as one setup.",
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
    implementation: "not_verified",
    tickArgPolicy: "none",
    supportedRoles: ["direction", "setup"],
    semanticEvents: [
      {
        id: "swing_bias",
        roles: ["direction"],
        queryFunctions: ["not_verified:swing_structure_bias"],
        meaning: "Market direction inferred from higher highs/lows or lower highs/lows.",
      },
      {
        id: "swing_level",
        roles: ["setup"],
        queryFunctions: ["not_verified:swing_structure_level"],
        meaning: "Recent swing point or swing range used as a setup reference.",
      },
    ],
    params: [
      {
        name: "lookback",
        type: "int",
        default: 50,
        description: "Bars scanned for swing structure.",
      },
    ],
    aliases: ["swing structure", "swing high", "swing low", "higher highs", "lower lows"],
    notes: "Exposed in the visual builder but not yet backed by a verified inline state machine.",
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
    implementation: "template",
    tickArgPolicy: "none",
    supportedRoles: ["direction", "setup", "execution"],
    semanticEvents: [
      {
        id: "band_touch",
        roles: ["setup", "execution"],
        queryFunctions: ["template:bb_touch"],
        meaning: "Price touches or rejects a Bollinger Band.",
      },
      {
        id: "band_breakout",
        roles: ["direction", "setup", "execution"],
        queryFunctions: ["template:bb_breakout"],
        meaning: "Price closes outside a Bollinger Band.",
      },
    ],
    params: [
      { name: "period", type: "int", default: 20, description: "Bollinger period." },
      { name: "deviation", type: "double", default: 2, description: "Band deviation." },
    ],
    aliases: ["bollinger", "bollinger bands", "bb", "upper band", "lower band"],
    notes: "Currently a template primitive, not an inline state machine.",
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
    implementation: "template",
    tickArgPolicy: "none",
    supportedRoles: ["execution"],
    semanticEvents: [
      {
        id: "pin_bar",
        roles: ["execution"],
        queryFunctions: ["template:pin_bar"],
        meaning: "Pin bar / hammer / shooting-star rejection candle.",
      },
    ],
    params: [],
    aliases: ["pin bar", "hammer", "shooting star", "long wick"],
    notes: "Template-level candle primitive, not an inline state machine yet.",
  },
};

export function getModuleContract(moduleId: string): ModuleContract | undefined {
  return MODULE_CONTRACTS[moduleId] ?? MODULE_CONTRACTS[moduleId.replace(/^ob$/, "order_block")];
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
