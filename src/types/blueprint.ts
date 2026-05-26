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
