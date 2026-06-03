// Universal StrategyBlueprint — replaces the old EMA-hardcoded StrategySpec.
// The AI extracts this from any plain-English strategy description.

export type RuleType =
  // Indicator-based
  | "ema_cross"
  | "ema_touch"
  | "ema_alignment"
  | "ema_band"
  | "sma_cross"
  | "sma_touch"
  | "sma_alignment"
  | "rsi_level"
  | "rsi_overbought"
  | "rsi_oversold"
  | "rsi_divergence"
  | "macd_cross"
  | "macd_signal"
  | "macd_histogram"
  | "bollinger_touch"
  | "bollinger_breakout"
  | "bollinger_squeeze"
  | "atr_volatility"
  | "atr_trailing"
  | "vwap_cross"
  | "vwap_direction"
  | "stochastic_cross"
  | "stochastic_level"
  | "adx_strength"
  // Price action
  | "support_resistance"
  | "horizontal_level"
  | "demand_zone"
  | "supply_zone"
  | "order_block_bullish"
  | "order_block_bearish"
  | "fair_value_gap_bullish"
  | "fair_value_gap_bearish"
  | "liquidity_sweep_high"
  | "liquidity_sweep_low"
  | "bos"
  | "choch"
  | "mss"
  | "engulfing_bullish"
  | "engulfing_bearish"
  | "pin_bar_bullish"
  | "pin_bar_bearish"
  | "inside_bar"
  | "doji"
  | "hammer"
  | "shooting_star"
  | "double_top"
  | "double_bottom"
  | "head_shoulders"
  | "inverse_head_shoulders"
  // Structural
  | "trend_filter_htf"
  | "trend_direction"
  | "breakout_high"
  | "breakout_low"
  | "range_boundary_high"
  | "range_boundary_low"
  | "pullback_retracement"
  | "continuation_pattern"
  // Filters
  | "session_filter"
  | "time_filter"
  | "spread_filter"
  | "news_filter"
  | "volatility_filter"
  // Escape hatch
  | "custom";

export interface NormalizedRule {
  id: string;
  type: RuleType | string;
  side: "buy" | "sell" | "both" | "filter";
  label: string;
  parameters: Record<string, unknown>;
  compilable: boolean;
  subjectiveNote?: string;
  mql5Hint?: string;
}

export interface StrategyBlueprint {
  version: "2.0";
  name: string;
  strategyType: string[];
  marketPhilosophy: string;

  rules: NormalizedRule[];

  risk: {
    riskPercent: number;
    rewardRisk: number;
    lotSizingMethod: "equity_percent" | "fixed_lot" | "atr_based";
    stopType: "candle_extreme" | "swing_point" | "zone_opposite" | "fixed_points" | "atr_based";
    stopBufferPoints: number;
    trailingStop: boolean;
    breakevenEnabled: boolean;
    partialClose: boolean;
    maxOpenTrades: number;
    maxDailyLossPercent?: number;
  };

  execution: {
    symbol: string;
    setupTimeframe: string;
    entryTimeframe: string;
    orderType: "market" | "pending_limit" | "pending_stop";
    setupExpiryBars: number;
    sessionFilter: string[];
    spreadFilterPoints: number;
    magicNumber: number;
  };

  compilable: boolean;
  compilableRuleIds: string[];
  subjectiveRuleIds: string[];
  pendingClarifications: string[];
  confidence: number;
  summary?: string;
  /** Cross-brain notes used by the 4-Brain AI wiring path. */
  strategyNotes?: string;
  /** Built-in MT5 indicators mentioned by the trader. These are primitives, not modules. */
  indicatorRefs?: Array<{
    id: string;
    name: string;
    category: string;
    via: "builtin" | "icustom";
    mql5: string;
    status: "builtin_indicator";
    note: string;
  }>;
  /** Verified built-in indicator filters extracted from the trader's words. */
  filterRefs?: Array<{
    id: string;
    label: string;
    indicatorId: string;
    role: "filter";
    appliesTo?: "setup" | "execution";
    timeframe: string;
    params: Record<string, unknown>;
    status: "builtin_filter";
    note: string;
  }>;
  /** Deterministic audit notes from strategy intake. These explain preserved or corrected intent. */
  blueprintAudit?: Array<{
    code: string;
    severity: "info" | "warn" | "error";
    message: string;
  }>;

  /**
   * Optional 4-brain configuration.
   * When present, the template generator produces a 4-brain EA instead of
   * the flat-rules EA. All existing flat-rules strategies continue to work
   * unchanged when this field is absent.
   */
  fourBrain?: FourBrainConfig;
}

export const DEFAULT_BLUEPRINT: StrategyBlueprint = {
  version: "2.0",
  name: "Untitled Strategy",
  strategyType: [],
  marketPhilosophy: "",
  rules: [],
  risk: {
    riskPercent: 1,
    rewardRisk: 2,
    lotSizingMethod: "equity_percent",
    stopType: "candle_extreme",
    stopBufferPoints: 20,
    trailingStop: false,
    breakevenEnabled: false,
    partialClose: false,
    maxOpenTrades: 1,
  },
  execution: {
    symbol: "EURUSD",
    setupTimeframe: "H1",
    entryTimeframe: "M5",
    orderType: "market",
    setupExpiryBars: 24,
    sessionFilter: [],
    spreadFilterPoints: 25,
    magicNumber: 990001,
  },
  compilable: false,
  compilableRuleIds: [],
  subjectiveRuleIds: [],
  pendingClarifications: [],
  confidence: 0,
};

export const TIMEFRAMES = ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

// ─── 4-Brain Architecture ─────────────────────────────────────────────────────
// Each brain is assigned one module and one timeframe.
// The template generator wires them into a single self-contained EA with
// three independent bar-open loops and confluence gating between brains.

export type BrainModuleType =
  | "bos"
  | "choch" // structural break — bias detection
  | "bos_choch" // combined BOS + CHoCH detection
  | "swing_structure" // multi-bar swing structure
  | "fvg" // fair value gap — zone setup or execution trigger
  | "fvg_inversion" // inverted FVG pattern
  | "order_block" // order block  — zone setup or execution trigger
  | "liqsweep" // liquidity sweep — execution trigger
  | "breakout" // price break beyond a defined level
  | "snr" // classic S/R — zone setup
  | "gap_snr" // S/R at gap edges
  | "rejection" // Reactive SNR — wick rejection off a level
  | "miss" // Reactive SNR — price misses a level (liquidity)
  | "bb" // Bollinger Bands
  | "ema" // EMA trend — direction bias
  | "engulfing" // candle pattern — execution trigger
  | "pin_bar"; // candle pattern — execution trigger

export interface BrainConfig {
  /**
   * One or more modules assigned to this brain.
   * Multiple modules are combined with OR logic — any confirmed module
   * activates the brain's output (gBias for direction, gSetupActive for setup,
   * entry signal for execution). The user describes how they interact in
   * the `description` field; AI extracts params from it.
   */
  modules: BrainModuleType[];
  timeframe: string; // e.g. "D1", "H4", "M15"
  params?: Record<string, unknown>;
  /** Plain-English description of how the selected modules work together. */
  description?: string;
}

/**
 * Describes the four-brain strategy structure.
 * direction and setup are optional — absent brains are bypassed (no gating).
 * execution is required — it is the trade trigger.
 */
export interface FourBrainConfig {
  direction?: BrainConfig; // sets gBias = BUY / SELL / NEUTRAL
  setup?: BrainConfig; // sets gSetupActive + gSetupDir + gSetupSLHint
  execution: BrainConfig; // fires the trade when Direction + Setup agree
  management?: ManagementBrainConfig;
}

/**
 * Parameters for MQL5 code generation using the modular 4-brain system.
 *
 * When `aiWiring` is provided, the generator uses AI-written brain functions
 * (from /api/gen-4brain-ai) and embeds only the state machines Claude selected.
 * Without `aiWiring`, falls back to the template switch-case generators.
 */
export interface MQL5CodeGenParams {
  eaName: string;
  config: FourBrainConfig;
  globalSymbol?: string;
  globalMagic?: number;
  /** Verified built-in filter refs to apply in deterministic/template mode. */
  filterRefs?: StrategyBlueprint["filterRefs"];
  /** When set, use AI-generated brain wiring instead of template generators. */
  aiWiring?: import("@/lib/api-client").AiBrainWiring;
}

/**
 * Management Brain configuration: risk/exit settings.
 */
export interface ManagementBrainConfig {
  riskPercent?: number;
  rewardRisk?: number;
  stopBuffer?: number;
  breakEvenEnabled?: boolean;
  breakEvenAtR?: number;
  maxOpenTrades?: number;
  /** Maximum allowed SL distance in POINTS. 0 = no limit. Trades whose SL
   *  distance exceeds this are skipped (e.g. 70 points = 7 pips on a 5-digit pair). */
  maxStopPoints?: number;
}
