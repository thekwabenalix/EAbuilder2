/**
 * Deterministic MQL5 EA generator — always produces compilable output.
 * No AI involved. Reads a StrategyBlueprint and emits proven MQL5 patterns.
 *
 * Architecture:
 *   - "Trigger" rules fire the entry (OR'd: any active trigger is enough)
 *   - "Filter" rules gate the entry (AND'd: all filters must pass)
 *   - Primary signal type is detected from blueprint rules; NOT hardcoded
 *
 * Trigger rules (generate real entry conditions):
 *   Indicator:    ema_cross, sma_cross, ema_touch, macd_cross, macd_histogram,
 *                 rsi_overbought, rsi_oversold, bollinger_touch, bollinger_breakout,
 *                 stochastic_cross
 *   Candle:       engulfing_bullish/bearish, pin_bar_bullish/bearish,
 *                 inside_bar, doji, hammer, shooting_star
 *   SMC / PA:     bos, choch, mss, fair_value_gap_bullish/bearish,
 *                 order_block_bullish/bearish, liquidity_sweep_high/low,
 *                 demand_zone, supply_zone, breakout_high/low,
 *                 support_resistance, horizontal_level,
 *                 pullback_retracement, continuation_pattern
 *
 * Filter rules (gate entry, all must pass):
 *   ema_alignment, ema_band, rsi_level, adx_strength,
 *   stochastic_level, trend_filter_htf, trend_direction,
 *   session_filter, time_filter, spread_filter,
 *   atr_volatility, volatility_filter
 *
 * Rules with no template implementation emit a // TODO comment.
 */

import type { StrategyBlueprint, NormalizedRule } from "@/types/blueprint";

// ─── Primitive registries (single source of truth) ───────────────────────────
// These are the rule types that have a concrete template implementation.
// Any rule NOT in one of these sets will be flagged as unsupported in the UI
// BEFORE code is generated — so users fix their spec, not their MQL5.

/** Rules that generate actual entry conditions (OR'd in CheckEntrySignal). */
export const TRIGGER_RULE_TYPES = new Set([
  "ema_cross", "sma_cross", "ema_touch",
  "rsi_overbought", "rsi_oversold",
  "macd_cross", "macd_signal", "macd_histogram",
  "bollinger_touch", "bollinger_breakout", "bollinger_squeeze",
  "stochastic_cross",
  "bos", "choch", "mss",
  "fair_value_gap_bullish", "fair_value_gap_bearish",
  "order_block_bullish", "order_block_bearish",
  "liquidity_sweep_high", "liquidity_sweep_low",
  "demand_zone", "supply_zone",
  "engulfing_bullish", "engulfing_bearish",
  "pin_bar_bullish", "pin_bar_bearish",
  "inside_bar", "doji", "hammer", "shooting_star",
]);

/** Rules that gate entry (AND'd in CheckEntrySignal). */
export const FILTER_RULE_TYPES = new Set([
  "ema_alignment", "ema_band",
  "rsi_level", "adx_strength", "stochastic_level",
  "trend_filter_htf", "trend_direction",
  "session_filter", "time_filter",
  "spread_filter",
  "atr_trailing", "atr_volatility", "volatility_filter",
  // Trade-management primitives — govern execution, not signal detection
  "fixed_rr_take_profit",   // TP = entry ± (risk_dist × reward_ratio)
  "max_open_trades_filter", // block entries when open positions ≥ max
]);

/** Union of all rule types that have any template implementation. */
export const SUPPORTED_RULE_TYPES = new Set([
  ...TRIGGER_RULE_TYPES,
  ...FILTER_RULE_TYPES,
]);

// ─── Buildability analysis ────────────────────────────────────────────────────

// Keywords that identify FVG sub-mechanics in rule labels.
// When the FVG state machine is active these are ALL implemented — they should
// not appear as "unsupported" even if the interview expanded them into extra rules.
const FVG_MECHANIC_KEYWORDS = [
  "retest", "confirm", "invalidat", "expir",
  "buy at market", "sell at market",
  "stop loss", "breakeven", "break-even", "break even",
  "one trade", "per fvg", "candle wick", "candle closes",
  "upper limit", "lower limit",
];

function isFvgSubRule(rule: NormalizedRule): boolean {
  const label = rule.label.toLowerCase();
  return (
    rule.type === "custom" &&
    FVG_MECHANIC_KEYWORDS.some((kw) => label.includes(kw))
  );
}

export interface RuleBuildStatus {
  rule: NormalizedRule;
  /**
   * "trigger"       = generates an entry condition
   * "filter"        = gates entry (must pass for trade to fire)
   * "state_machine" = implemented by a higher-level state machine (e.g. FVG)
   * "unsupported"   = no implementation — needs a primitive or spec refinement
   */
  category: "trigger" | "filter" | "state_machine" | "unsupported";
}

export interface BuildabilityResult {
  /** True if the EA will actually trade (at least 1 supported trigger, or FVG state machine). */
  buildable: boolean;
  /** 0–100 — what fraction of the blueprint rules have template implementations. */
  coverage: number;
  statuses: RuleBuildStatus[];
  supportedCount: number;
  unsupportedCount: number;
  unsupportedRules: NormalizedRule[];
  /** True when the FVG state machine covers entries (FVG rules always build). */
  hasFvgMachine: boolean;
}

/**
 * Validate every rule in a blueprint against the primitive registry.
 * Call this BEFORE generating code — surface unsupported rules in the UI
 * so the user refines their spec rather than getting broken MQL5.
 */
export function analyzeBuildability(bp: StrategyBlueprint): BuildabilityResult {
  const hasFvgMachine = bp.rules.some(
    (r) => r.type === "fair_value_gap_bullish" || r.type === "fair_value_gap_bearish",
  );

  const statuses: RuleBuildStatus[] = bp.rules.map((rule) => {
    if (TRIGGER_RULE_TYPES.has(rule.type)) return { rule, category: "trigger" };
    if (FILTER_RULE_TYPES.has(rule.type))  return { rule, category: "filter"  };

    // When the FVG state machine is active, "custom" rules that describe FVG mechanics
    // (retest, confirmation, invalidation, expiry, entry, SL, BE, one-per-zone) are
    // already implemented by the state machine — not unsupported.
    // This also covers the case where the AI interview incorrectly expanded a single
    // FVG primitive into many sub-rules before the consolidation prompt was deployed.
    if (hasFvgMachine && isFvgSubRule(rule)) return { rule, category: "state_machine" };

    return { rule, category: "unsupported" };
  });

  const hasSupportedTrigger = statuses.some((s) => s.category === "trigger");
  const supportedCount = statuses.filter((s) => s.category !== "unsupported").length;
  const unsupportedRules = statuses
    .filter((s) => s.category === "unsupported")
    .map((s) => s.rule);

  return {
    buildable: hasFvgMachine || hasSupportedTrigger,
    coverage:
      bp.rules.length === 0 ? 100 : Math.round((supportedCount / bp.rules.length) * 100),
    statuses,
    supportedCount,
    unsupportedCount: unsupportedRules.length,
    unsupportedRules,
    hasFvgMachine,
  };
}

// ─── Small utilities ──────────────────────────────────────────────────────────

function findRule(rules: NormalizedRule[], ...types: string[]): NormalizedRule | undefined {
  return rules.find((r) => types.includes(r.type));
}

function findRules(rules: NormalizedRule[], ...types: string[]): NormalizedRule[] {
  return rules.filter((r) => types.includes(r.type));
}

function param<T>(rule: NormalizedRule | undefined, key: string, fallback: T): T {
  if (!rule) return fallback;
  const v = rule.parameters?.[key];
  return v !== undefined ? (v as T) : fallback;
}

function safeInt(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  return isNaN(n) ? fallback : Math.max(lo, Math.min(hi, Math.round(n)));
}

function safeFloat(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  return isNaN(n) ? fallback : Math.max(lo, Math.min(hi, n));
}

function tfConst(tf: string): string {
  const u = tf.toUpperCase();
  return u === "MN" ? "PERIOD_MN1" : `PERIOD_${u}`;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface Ctx {
  // MA / EMA
  hasEMA: boolean;
  fastPeriod: number;
  slowPeriod: number;
  useSetupTF: boolean;

  // RSI
  hasRSI: boolean;
  rsiPeriod: number;
  rsiBuyMax: number;
  rsiSellMin: number;
  rsiFilterLevel: number; // for ema_alignment + rsi_level filter

  // MACD
  hasMACD: boolean;
  macdFast: number;
  macdSlow: number;
  macdSig: number;

  // ADX (filter only)
  hasADX: boolean;
  adxPeriod: number;
  adxMin: number;

  // Bollinger
  hasBB: boolean;
  bbPeriod: number;
  bbDev: number;

  // Stochastic
  hasStoch: boolean;
  stochK: number;
  stochD: number;
  stochSlowing: number;
  stochBuyMax: number;
  stochSellMin: number;

  // ATR
  hasATR: boolean;
  atrPeriod: number;
  atrMult: number;

  // HTF trend filter
  hasHTF: boolean;
  htfPeriod: number;

  // Session
  hasSession: boolean;
  sessionStart: number;
  sessionEnd: number;

  // SMC / Price Action
  hasBOS: boolean;
  bosLookback: number;
  hasFVG: boolean;
  hasOrderBlock: boolean;
  obLookback: number;
  obATRPeriod: number;
  obDispMult: number;
  obScanBack: number;
  obExpiry: number;
  hasLiquiditySweep: boolean;
  liqLookback: number;
  hasZone: boolean; // demand/supply zones

  // Candle patterns
  hasEngulfing: boolean;
  hasPinBar: boolean;
  hasInsideBar: boolean;
  hasHammer: boolean;

  stopType: StrategyBlueprint["risk"]["stopType"];
  /** true when execution.symbol === "ANY" — emit #define InpSymbol _Symbol instead of an input */
  useChartSymbol: boolean;

  // Trade-management primitives
  /** fixed_rr_take_profit: TP = entry ± (risk_dist × rewardRatio) */
  hasFixedRR: boolean;
  rrRatio: number;
  /** max_open_trades_filter: block new entries when open positions ≥ maxOpenTrades */
  hasMaxTradesFilter: boolean;
  maxOpenTrades: number;
}

function analyze(bp: StrategyBlueprint): Ctx {
  const r = bp.rules;

  const emaRule  = findRule(r, "ema_cross", "sma_cross", "ema_touch");
  const emaAlign = findRule(r, "ema_alignment", "ema_band");
  const rsiTrig  = findRule(r, "rsi_overbought", "rsi_oversold");
  const rsiFilter = findRule(r, "rsi_level");
  const rsiRule  = rsiTrig ?? rsiFilter;
  const macdRule = findRule(r, "macd_cross", "macd_signal", "macd_histogram");
  const adxRule  = findRule(r, "adx_strength");
  const bbRule   = findRule(r, "bollinger_touch", "bollinger_breakout", "bollinger_squeeze");
  const stochRule = findRule(r, "stochastic_cross", "stochastic_level");
  const atrRule  = findRule(r, "atr_trailing", "atr_volatility");
  const htfRule  = findRule(r, "trend_filter_htf", "trend_direction");
  const sesRule  = findRule(r, "session_filter", "time_filter");
  const bosRule  = findRule(r, "bos", "choch", "mss");
  const fvgRule  = findRule(r, "fair_value_gap_bullish", "fair_value_gap_bearish");
  const obRule   = findRule(r, "order_block_bullish", "order_block_bearish");
  const liqRule  = findRule(r, "liquidity_sweep_high", "liquidity_sweep_low");
  const zoneRule = findRule(r, "demand_zone", "supply_zone");
  const engulf   = findRule(r, "engulfing_bullish", "engulfing_bearish");
  const pinBar   = findRule(r, "pin_bar_bullish", "pin_bar_bearish");
  const insideBar = findRule(r, "inside_bar");
  const hammer   = findRule(r, "hammer", "shooting_star", "doji");
  const fixedRRRule    = findRule(r, "fixed_rr_take_profit");
  const maxTradesRule  = findRule(r, "max_open_trades_filter");

  // Use ema_alignment period for the filter EMA if no cross rule
  const emaSource = emaRule ?? emaAlign;
  const fastDef = 9;
  const slowDef = 21;
  const fast = safeInt(param(emaSource, "fastPeriod", param(emaSource, "fast", fastDef)), fastDef, 2, 500);
  const slow = safeInt(param(emaSource, "slowPeriod", param(emaSource, "slow", slowDef)), slowDef, 2, 500);

  return {
    hasEMA: Boolean(emaRule ?? emaAlign),
    fastPeriod: fast,
    slowPeriod: Math.max(fast + 1, slow),
    useSetupTF: bp.execution.setupTimeframe !== bp.execution.entryTimeframe,

    hasRSI: Boolean(rsiRule),
    rsiPeriod:    safeInt(param(rsiRule, "period", 14), 14, 2, 100),
    rsiBuyMax:    safeInt(param(rsiTrig, "oversoldLevel",   param(rsiTrig, "level", 35)), 35, 10, 90),
    rsiSellMin:   safeInt(param(rsiTrig, "overboughtLevel", param(rsiTrig, "level", 65)), 65, 10, 90),
    rsiFilterLevel: safeInt(param(rsiFilter, "level", 50), 50, 10, 90),

    hasMACD: Boolean(macdRule),
    macdFast: safeInt(param(macdRule, "fastPeriod", param(macdRule, "fast", 12)), 12, 2, 200),
    macdSlow: safeInt(param(macdRule, "slowPeriod", param(macdRule, "slow", 26)), 26, 2, 500),
    macdSig:  safeInt(param(macdRule, "signalPeriod", param(macdRule, "signal", 9)), 9, 1, 100),

    hasADX: Boolean(adxRule),
    adxPeriod: safeInt(param(adxRule, "period", 14), 14, 2, 100),
    adxMin:    safeInt(param(adxRule, "minStrength", param(adxRule, "threshold", 25)), 25, 1, 100),

    hasBB: Boolean(bbRule),
    bbPeriod: safeInt(param(bbRule, "period", 20), 20, 2, 500),
    bbDev:    safeFloat(param(bbRule, "deviation", param(bbRule, "stdDev", 2.0)), 2.0, 0.1, 5.0),

    hasStoch: Boolean(stochRule),
    stochK:       safeInt(param(stochRule, "kPeriod",   param(stochRule, "k", 5)),   5, 1, 100),
    stochD:       safeInt(param(stochRule, "dPeriod",   param(stochRule, "d", 3)),   3, 1, 100),
    stochSlowing: safeInt(param(stochRule, "slowing", 3), 3, 1, 100),
    stochBuyMax:  safeInt(param(stochRule, "oversoldLevel",   param(stochRule, "level", 30)), 30, 5, 50),
    stochSellMin: safeInt(param(stochRule, "overboughtLevel", param(stochRule, "level", 70)), 70, 50, 95),

    hasATR: Boolean(atrRule) || bp.risk.stopType === "atr_based",
    atrPeriod: safeInt(param(atrRule, "period", 14), 14, 1, 100),
    atrMult:   safeFloat(param(atrRule, "multiplier", 2.0), 2.0, 0.1, 10.0),

    hasHTF: Boolean(htfRule),
    htfPeriod: safeInt(param(htfRule, "period", param(htfRule, "maPeriod", slow)), slow, 2, 500),

    hasSession: Boolean(sesRule) || bp.execution.sessionFilter.length > 0,
    sessionStart: safeInt(sesRule ? param(sesRule, "startHour", param(sesRule, "start", 8)) : 8, 8, 0, 23),
    sessionEnd:   safeInt(sesRule ? param(sesRule, "endHour",   param(sesRule, "end",  17)) : 17, 17, 0, 23),

    // SMC / PA
    hasBOS: Boolean(bosRule),
    bosLookback: safeInt(param(bosRule, "lookback", param(bosRule, "period", 20)), 20, 5, 200),

    hasFVG: Boolean(fvgRule),

    hasOrderBlock: Boolean(obRule),
    obLookback:   safeInt(param(obRule, "lookback", 20), 20, 5, 100),
    obATRPeriod:  safeInt(param(obRule, "atrPeriod", 14), 14, 2, 50),
    obDispMult:   safeFloat(param(obRule, "dispMult", 1.5), 1.5, 0.5, 5.0),
    obScanBack:   safeInt(param(obRule, "scanBack", 5), 5, 1, 20),
    obExpiry:     safeInt(param(obRule, "expiry", 100), 100, 0, 500),

    hasLiquiditySweep: Boolean(liqRule),
    liqLookback: safeInt(param(liqRule, "lookback", 20), 20, 5, 100),

    hasZone: Boolean(zoneRule),

    hasEngulfing: Boolean(engulf),
    hasPinBar:    Boolean(pinBar),
    hasInsideBar: Boolean(insideBar),
    hasHammer:    Boolean(hammer),

    stopType: bp.risk.stopType,
    useChartSymbol: (bp.execution.symbol ?? "").toUpperCase() === "ANY",

    hasFixedRR: Boolean(fixedRRRule),
    rrRatio: safeFloat(
      param(fixedRRRule, "reward_ratio", param(fixedRRRule, "rewardRatio", bp.risk.rewardRisk ?? 2.0)),
      2.0, 0.1, 100,
    ),

    hasMaxTradesFilter: Boolean(maxTradesRule),
    maxOpenTrades: safeInt(
      param(maxTradesRule, "max_open_trades", param(maxTradesRule, "maxOpenTrades", bp.risk.maxOpenTrades ?? 1)),
      1, 1, 100,
    ),
  };
}

// ─── Header & inputs ──────────────────────────────────────────────────────────

function genHeader(bp: StrategyBlueprint): string {
  const safeName = (bp.name || "EA_Builder_Strategy").replace(/[^\w\s-]/g, "").trim();
  return `//+------------------------------------------------------------------+
//| ${safeName}.mq5
//| Generated by EA Builder (template mode — always compiles)
//| Strategy type: ${bp.strategyType.join(", ") || "universal"}
//|
//| DISCLAIMER: Generated code is for research and educational use only.
//| Always forward-test on a demo account before live trading.
//+------------------------------------------------------------------+
#property copyright "EA Builder"
#property version   "1.00"
#property strict

#include <Trade/Trade.mqh>
CTrade trade;

`;
}

function genInputs(bp: StrategyBlueprint, ctx: Ctx): string {
  const { risk, execution } = bp;
  const lines: string[] = [
    `//--- General`,
    // When the user said "ANY", the EA binds to _Symbol via a #define — no string input needed.
    ...(ctx.useChartSymbol
      ? []
      : [`input string  InpSymbol          = "${execution.symbol ?? "EURUSD"}";  // Trading symbol`]),
    `input ENUM_TIMEFRAMES InpSetupTF = ${tfConst(execution.setupTimeframe ?? "H1")};  // Setup timeframe`,
    `input ENUM_TIMEFRAMES InpEntryTF = ${tfConst(execution.entryTimeframe ?? "M5")};  // Entry timeframe`,
    ``,
    `//--- Risk management`,
    `input double  InpRiskPercent     = ${risk.riskPercent ?? 1.0};    // Risk per trade (% equity)`,
    `input double  InpRewardRisk      = ${risk.rewardRisk ?? 2.0};     // Reward:risk ratio`,
    `input int     InpStopBuffer      = ${risk.stopBufferPoints ?? 20}; // Stop buffer (points)`,
    `input int     InpMaxSpread       = ${execution.spreadFilterPoints ?? 25}; // Max spread (0 = off)`,
    `input long    InpMagic           = ${execution.magicNumber ?? 990001}; // EA magic number`,
    ``,
  ];

  if (ctx.hasEMA) {
    lines.push(`//--- Moving averages`);
    lines.push(`input int InpFastMA = ${ctx.fastPeriod};  // Fast MA period`);
    lines.push(`input int InpSlowMA = ${ctx.slowPeriod};  // Slow MA period`);
    lines.push(``);
  }
  if (ctx.hasRSI) {
    lines.push(`//--- RSI`);
    lines.push(`input int InpRSIPeriod   = ${ctx.rsiPeriod};  // RSI period`);
    lines.push(`input int InpRSIBuyMax   = ${ctx.rsiBuyMax};  // Buy when RSI below this (oversold)`);
    lines.push(`input int InpRSISellMin  = ${ctx.rsiSellMin}; // Sell when RSI above this (overbought)`);
    lines.push(``);
  }
  if (ctx.hasMACD) {
    lines.push(`//--- MACD`);
    lines.push(`input int InpMACDFast   = ${ctx.macdFast};  // MACD fast EMA`);
    lines.push(`input int InpMACDSlow   = ${ctx.macdSlow};  // MACD slow EMA`);
    lines.push(`input int InpMACDSignal = ${ctx.macdSig};   // MACD signal`);
    lines.push(``);
  }
  if (ctx.hasADX) {
    lines.push(`//--- ADX trend filter`);
    lines.push(`input int InpADXPeriod = ${ctx.adxPeriod};  // ADX period`);
    lines.push(`input int InpADXMin    = ${ctx.adxMin};     // Minimum ADX for entry`);
    lines.push(``);
  }
  if (ctx.hasBB) {
    lines.push(`//--- Bollinger Bands`);
    lines.push(`input int    InpBBPeriod = ${ctx.bbPeriod ?? 20};    // Bollinger period`);
    lines.push(`input double InpBBDev    = ${(ctx.bbDev ?? 2.0).toFixed(1)};  // Bollinger std-dev`);
    lines.push(``);
  }
  if (ctx.hasStoch) {
    lines.push(`//--- Stochastic`);
    lines.push(`input int InpStochK       = ${ctx.stochK};        // %K period`);
    lines.push(`input int InpStochD       = ${ctx.stochD};        // %D period`);
    lines.push(`input int InpStochSlowing = ${ctx.stochSlowing};  // Slowing`);
    lines.push(`input int InpStochBuyMax  = ${ctx.stochBuyMax};   // Buy threshold`);
    lines.push(`input int InpStochSellMin = ${ctx.stochSellMin};  // Sell threshold`);
    lines.push(``);
  }
  if (ctx.hasATR) {
    lines.push(`//--- ATR`);
    lines.push(`input int    InpATRPeriod = ${ctx.atrPeriod};  // ATR period`);
    lines.push(`input double InpATRMult   = ${(ctx.atrMult ?? 2.0).toFixed(1)};  // ATR stop multiplier`);
    lines.push(``);
  }
  if (ctx.hasHTF) {
    lines.push(`//--- HTF trend filter`);
    lines.push(`input int InpHTFPeriod = ${ctx.htfPeriod};  // HTF EMA period`);
    lines.push(``);
  }
  if (ctx.hasSession) {
    lines.push(`//--- Session filter (server time)`);
    lines.push(`input int InpSessionStart = ${ctx.sessionStart};  // Session start hour`);
    lines.push(`input int InpSessionEnd   = ${ctx.sessionEnd};    // Session end hour`);
    lines.push(``);
  }
  if (ctx.hasBOS) {
    lines.push(`//--- Structure break (BOS / CHoCH)`);
    lines.push(`input int InpBOSLookback = ${ctx.bosLookback};  // Bars to scan for structure`);
    lines.push(``);
  }
  if (ctx.hasOrderBlock) {
    lines.push(`//--- Order Block`);
    lines.push(`input int    InpOBATRPeriod = ${ctx.obATRPeriod};   // ATR period for displacement filter`);
    lines.push(`input double InpOBDispMult  = ${ctx.obDispMult.toFixed(1)};   // Displacement body ≥ N × ATR`);
    lines.push(`input int    InpOBScanBack  = ${ctx.obScanBack};    // Bars before displacement to search for OB candle`);
    lines.push(`input int    InpOBExpiry    = ${ctx.obExpiry};      // OB expiry (bars, 0 = never)`);
    lines.push(``);
  }
  if (ctx.hasLiquiditySweep) {
    lines.push(`//--- Liquidity sweep`);
    lines.push(`input int InpLiqLookback = ${ctx.liqLookback};  // Bars to scan for recent highs/lows`);
    lines.push(``);
  }
  if (ctx.hasFVG) {
    lines.push(`//--- Fair Value Gap`);
    lines.push(`input int InpFVGExpiry = 50;  // FVG expiry (bars, 0 = never)`);
    lines.push(``);
  }
  if (ctx.hasMaxTradesFilter) {
    lines.push(`//--- Trade count limit`);
    lines.push(`input int InpMaxTrades = ${ctx.maxOpenTrades};  // Max simultaneous open positions (0 = unlimited)`);
    lines.push(``);
  }

  // FVG always uses break-even (managed by FVG_ManageBreakEven); default is 0.5R.
  // Non-FVG strategies only emit this input when the blueprint enables break-even.
  if (ctx.hasFVG || ctx.hasOrderBlock) {
    lines.push(`//--- Break-even`);
    lines.push(`input double InpBEAtR = 0.5;  // Move SL to B/E at this R multiple`);
    lines.push(``);
  } else if (risk.breakevenEnabled) {
    lines.push(`//--- Break-even`);
    lines.push(`input double InpBEAtR = 1.0;  // Move SL to B/E at this R multiple`);
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}

// ─── Globals ──────────────────────────────────────────────────────────────────

function genGlobals(ctx: Ctx): string {
  const lines: string[] = [];
  // When execution.symbol === "ANY" we bind to the chart symbol via a #define so that
  // every function that uses InpSymbol automatically trades the attached chart's symbol.
  if (ctx.useChartSymbol) {
    lines.push(`#define InpSymbol _Symbol  // EA always trades the chart symbol`);
    lines.push(``);
  }
  lines.push(`//--- Indicator handles`);
  if (ctx.hasEMA) {
    lines.push(`int hFastMA = INVALID_HANDLE;`);
    lines.push(`int hSlowMA = INVALID_HANDLE;`);
    if (ctx.useSetupTF) {
      lines.push(`int hFastSetup = INVALID_HANDLE;`);
      lines.push(`int hSlowSetup = INVALID_HANDLE;`);
    }
  }
  if (ctx.hasRSI)   lines.push(`int hRSI   = INVALID_HANDLE;`);
  if (ctx.hasMACD)  lines.push(`int hMACD  = INVALID_HANDLE;`);
  if (ctx.hasADX)   lines.push(`int hADX   = INVALID_HANDLE;`);
  if (ctx.hasBB)    lines.push(`int hBB    = INVALID_HANDLE;`);
  if (ctx.hasStoch) lines.push(`int hStoch = INVALID_HANDLE;`);
  if (ctx.hasATR)   lines.push(`int hATR   = INVALID_HANDLE;`);
  if (ctx.hasHTF)   lines.push(`int hHTF   = INVALID_HANDLE;`);
  lines.push(``, `static datetime lastBarTime = 0;`, ``);
  if (ctx.hasOrderBlock) {
    lines.push(
      `#define OB_ACTIVE      0`,
      `#define OB_RETESTED    1`,
      `#define OB_CONFIRMED   2`,
      `#define OB_TRADED      3`,
      `#define OB_MITIGATED   4`,
      `#define OB_INVALIDATED 5`,
      `#define OB_EXPIRED     6`,
      `#define MAX_OBS        200`,
      ``,
      `struct OBZone`,
      `{`,
      `   double   hi;`,
      `   double   lo;`,
      `   int      dir;        // 1=bullish, -1=bearish`,
      `   datetime obTime;     // OB candle open time`,
      `   datetime dispTime;   // displacement candle time (zone birth)`,
      `   int      state;`,
      `   double   retestLow;`,
      `   double   retestHigh;`,
      `   int      barsAlive;`,
      `   datetime retestBar;`,
      `   datetime confirmBar;`,
      `};`,
      ``,
      `OBZone obZones[MAX_OBS];`,
      `int    obCount = 0;`,
      ``,
    );
  }
  if (ctx.hasFVG) {
    lines.push(
      `#define FVG_ACTIVE    0`,
      `#define FVG_RETESTING 1`,
      `#define FVG_CONFIRMED 2`,
      `#define FVG_TRADED    3`,
      `#define FVG_INVALID   4`,
      `#define MAX_FVGS     200`,
      ``,
      `struct FVGZone`,
      `{`,
      `   double   ul;`,
      `   double   ll;`,
      `   int      dir;`,
      `   datetime createdAt;`,
      `   int      state;`,
      `   double   retestLow;`,
      `   double   retestHigh;`,
      `   int      barsAlive;`,
      `   // Validation & debug — both must be non-zero before a trade is allowed`,
      `   datetime retestBar;    // time of bar that first entered the FVG gap`,
      `   datetime confirmBar;   // time of bar that closed back outside the gap`,
      `};`,
      ``,
      `FVGZone fvgZones[MAX_FVGS];`,
      `int     fvgCount = 0;`,
      ``,
    );
  }
  return lines.join("\n") + "\n";
}

// ─── Proven helpers (verbatim — never change) ─────────────────────────────────

function genHelpers(): string {
  return `//+------------------------------------------------------------------+
//| Core helpers                                                     |
//+------------------------------------------------------------------+
double NormalizeVolume(double volume, string symbol)
{
   double minLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(lotStep <= 0) lotStep = 0.01;
   volume = MathFloor(volume / lotStep) * lotStep;
   if(volume < minLot) volume = minLot;
   if(volume > maxLot) volume = maxLot;
   int digits = 0; double step = lotStep;
   while(step < 1.0 && digits < 8) { step *= 10.0; digits++; }
   return NormalizeDouble(volume, digits);
}

double CalcLot(double stopDistPoints, string symbol, double riskPct)
{
   if(stopDistPoints <= 0) return 0.0;
   double equity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskMoney = equity * (riskPct / 100.0);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickValue <= 0) tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_PROFIT);
   if(tickValue <= 0) tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   double tickSize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double point     = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(tickValue <= 0 || tickSize <= 0 || point <= 0) return 0.0;
   double lossPerLot = (stopDistPoints * point / tickSize) * tickValue;
   if(lossPerLot <= 0) return 0.0;
   return NormalizeVolume(riskMoney / lossPerLot, symbol);
}

bool HasOpenPosition(string symbol, long magic)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) == symbol &&
         PositionGetInteger(POSITION_MAGIC)  == magic) return true;
   }
   return false;
}

// Count open positions for this EA on the given symbol.
// Used by max_open_trades_filter to allow more than one simultaneous trade.
int CountOpenPositions(string symbol, long magic)
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) == symbol &&
         PositionGetInteger(POSITION_MAGIC)  == magic) count++;
   }
   return count;
}

bool SpreadOk(string symbol, int maxPts)
{
   if(maxPts <= 0) return true;
   return (int)SymbolInfoInteger(symbol, SYMBOL_SPREAD) <= maxPts;
}

double IndVal(int handle, int buf, int shift)
{
   if(handle == INVALID_HANDLE) return 0.0;
   double arr[];
   ArraySetAsSeries(arr, true);
   if(CopyBuffer(handle, buf, shift, 1, arr) != 1) return 0.0;
   return arr[0];
}

`;
}

// ─── FVG State Machine generator ─────────────────────────────────────────────

function genFVGStateMachine(ctx: Ctx): string {
  return `//+------------------------------------------------------------------+
//| FVG State Machine                                                |
//| Detects 3-candle imbalances, tracks retest and confirmation,    |
//| enters on the bar AFTER confirmation (bar-open pattern).        |
//| States: ACTIVE -> RETESTING -> CONFIRMED -> TRADED / INVALID    |
//|                                                                  |
//| Validation layer: every trade is blocked unless retestBar and   |
//| confirmBar were explicitly recorded by FVG_Update. Each trade   |
//| is logged to the journal and marked on the chart before firing. |
//+------------------------------------------------------------------+

// Add a new FVG zone if it is not already tracked.
// Slot recycling: reuses the first TRADED/INVALID slot before appending.
// MAX_FVGS is only a hard cap — active zones are never evicted.
void FVG_Add(double ul, double ll, int dir)
{
   double point = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   // Dedup: skip terminal zones so their stale price data can't block new detection
   for(int i = 0; i < fvgCount; i++)
   {
      if(fvgZones[i].state >= FVG_TRADED) continue;
      if(fvgZones[i].dir != dir) continue;
      if(MathAbs(fvgZones[i].ul - ul) < 5.0 * point &&
         MathAbs(fvgZones[i].ll - ll) < 5.0 * point) return;
   }
   // Slot allocation: recycle a terminal slot before growing the pool
   int idx = -1;
   for(int i = 0; i < fvgCount; i++)
   {
      if(fvgZones[i].state == FVG_TRADED || fvgZones[i].state == FVG_INVALID)
        { idx = i; break; }
   }
   if(idx < 0)
   {
      if(fvgCount >= MAX_FVGS) return;
      idx = fvgCount++;
   }
   fvgZones[idx].ul         = ul;
   fvgZones[idx].ll         = ll;
   fvgZones[idx].dir        = dir;
   fvgZones[idx].createdAt  = TimeCurrent();
   fvgZones[idx].state      = FVG_ACTIVE;
   fvgZones[idx].retestLow  = ul;
   fvgZones[idx].retestHigh = ll;
   fvgZones[idx].barsAlive  = 0;
   fvgZones[idx].retestBar  = 0;   // set by FVG_Update when price first enters gap
   fvgZones[idx].confirmBar = 0;   // set by FVG_Update when price closes back outside
}

// Called on each new bar: detect 3-candle imbalance in the just-closed bars.
// shift 1 = C3 (newest closed bar), shift 3 = C1 (oldest of the 3).
void FVG_Detect()
{
   double c1Hi = iHigh(InpSymbol, InpEntryTF, 3);
   double c1Lo = iLow(InpSymbol,  InpEntryTF, 3);
   double c3Hi = iHigh(InpSymbol, InpEntryTF, 1);
   double c3Lo = iLow(InpSymbol,  InpEntryTF, 1);
   if(c1Hi <= 0 || c3Hi <= 0) return;

   if(c3Lo > c1Hi) FVG_Add(c3Lo, c1Hi,  1); // Bullish: C3.Low > C1.High
   if(c3Hi < c1Lo) FVG_Add(c1Lo, c3Hi, -1); // Bearish: C3.High < C1.Low
}

// Called on each new bar: update state of all active/retesting zones
// based on the just-closed bar (shift 1).
// Records retestBar and confirmBar — required by the validation gate.
void FVG_Update()
{
   double   c1Lo  = iLow(InpSymbol,   InpEntryTF, 1);
   double   c1Hi  = iHigh(InpSymbol,  InpEntryTF, 1);
   double   c1Cls = iClose(InpSymbol, InpEntryTF, 1);
   datetime c1T   = iTime(InpSymbol,  InpEntryTF, 1); // timestamp of just-closed bar

   for(int i = 0; i < fvgCount; i++)
   {
      int st = fvgZones[i].state;
      if(st == FVG_TRADED || st == FVG_INVALID) continue;

      fvgZones[i].barsAlive++;
      if(InpFVGExpiry > 0 && fvgZones[i].barsAlive > InpFVGExpiry)
         { fvgZones[i].state = FVG_INVALID; continue; }

      double ul = fvgZones[i].ul;
      double ll = fvgZones[i].ll;

      if(fvgZones[i].dir > 0) // Bullish FVG: wait for price to dip back into gap
      {
         if(st == FVG_ACTIVE)
         {
            if(c1Lo <= ul) // bar entered the gap from above
            {
               fvgZones[i].state     = FVG_RETESTING;
               fvgZones[i].retestLow = c1Lo;
               fvgZones[i].retestBar = c1T;           // record retest candle
               if(c1Cls > ul)
               {
                  fvgZones[i].state      = FVG_CONFIRMED; // same-bar bounce
                  fvgZones[i].confirmBar = c1T;            // retest + confirm on same bar
               }
               else if(c1Cls < ll) fvgZones[i].state = FVG_INVALID; // closed through gap
            }
         }
         else // FVG_RETESTING
         {
            if(c1Lo < fvgZones[i].retestLow) fvgZones[i].retestLow = c1Lo;
            if(c1Cls > ul)
            {
               fvgZones[i].state      = FVG_CONFIRMED;
               fvgZones[i].confirmBar = c1T; // record confirmation candle
            }
            else if(c1Cls < ll) fvgZones[i].state = FVG_INVALID;
         }
      }
      else // Bearish FVG: wait for price to rally back into gap
      {
         if(st == FVG_ACTIVE)
         {
            if(c1Hi >= ll) // bar entered the gap from below
            {
               fvgZones[i].state      = FVG_RETESTING;
               fvgZones[i].retestHigh = c1Hi;
               fvgZones[i].retestBar  = c1T;          // record retest candle
               if(c1Cls < ll)
               {
                  fvgZones[i].state      = FVG_CONFIRMED; // same-bar rejection
                  fvgZones[i].confirmBar = c1T;            // retest + confirm on same bar
               }
               else if(c1Cls > ul) fvgZones[i].state = FVG_INVALID; // closed through gap
            }
         }
         else // FVG_RETESTING
         {
            if(c1Hi > fvgZones[i].retestHigh) fvgZones[i].retestHigh = c1Hi;
            if(c1Cls < ll)
            {
               fvgZones[i].state      = FVG_CONFIRMED;
               fvgZones[i].confirmBar = c1T; // record confirmation candle
            }
            else if(c1Cls > ul) fvgZones[i].state = FVG_INVALID;
         }
      }
   }
}

// Draw an entry arrow and info label on the chart at the exact bar where
// the trade fires. Visible in both live trading and backtest visual mode —
// if you can see this marker you can trace exactly which FVG caused the trade.
void FVG_DrawTradeMarker(int idx, double price, double sl, double tp, datetime t)
{
   string pfx = "FVGENTRY_" + IntegerToString(idx) + "_" + IntegerToString((int)t);
   int    dir = fvgZones[idx].dir;

   // Built-in buy/sell arrow (always visible, even on small timeframes)
   string arrowName = pfx + "_arr";
   ENUM_OBJECT arrowType = dir > 0 ? OBJ_ARROW_BUY : OBJ_ARROW_SELL;
   if(ObjectCreate(0, arrowName, arrowType, 0, t, price))
   {
      ObjectSetInteger(0, arrowName, OBJPROP_COLOR,      dir > 0 ? clrDodgerBlue : clrOrangeRed);
      ObjectSetInteger(0, arrowName, OBJPROP_WIDTH,      2);
      ObjectSetInteger(0, arrowName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, arrowName, OBJPROP_BACK,       false);
   }

   // Text label: FVG id + direction + SL + TP for instant visual verification
   string labelName = pfx + "_lbl";
   string txt = StringFormat("FVG[%d] %s  SL:%.5f  TP:%.5f",
                             idx, dir > 0 ? "BUY" : "SELL", sl, tp);
   if(ObjectCreate(0, labelName, OBJ_TEXT, 0, t, price))
   {
      ObjectSetString( 0, labelName, OBJPROP_TEXT,      txt);
      ObjectSetInteger(0, labelName, OBJPROP_COLOR,     dir > 0 ? clrDodgerBlue : clrOrangeRed);
      ObjectSetInteger(0, labelName, OBJPROP_FONTSIZE,  8);
      ObjectSetInteger(0, labelName, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, labelName, OBJPROP_BACK,       false);
   }
}

// Called at bar open: execute market entries for CONFIRMED zones.
// Validation gate: trade is blocked if retestBar or confirmBar was never recorded.
// Full setup is logged to the journal and drawn on the chart before every order.
void FVG_ExecuteEntries()
{
   ${ctx.hasMaxTradesFilter
     ? `if(CountOpenPositions(InpSymbol, InpMagic) >= InpMaxTrades) return;`
     : `if(HasOpenPosition(InpSymbol, InpMagic)) return;`}
   if(!SpreadOk(InpSymbol, InpMaxSpread)) return;

   double   point    = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   double   ask      = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
   double   bid      = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   int      digits   = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   long     stops    = SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL);
   datetime entryBar = iTime(InpSymbol, InpEntryTF, 0);

   for(int i = 0; i < fvgCount; i++)
   {
      if(fvgZones[i].state != FVG_CONFIRMED) continue;

      //----------------------------------------------------------------
      // VALIDATION GATE
      // FVG_Update must have recorded both retestBar and confirmBar.
      // If either is still 0 the state machine skipped a required phase
      // — the zone is incomplete and the trade is unconditionally blocked.
      //----------------------------------------------------------------
      if(fvgZones[i].retestBar == 0 || fvgZones[i].confirmBar == 0)
      {
         PrintFormat("[FVG BLOCKED] Zone[%d] dir=%s UL=%.5f LL=%.5f | "
                     "Incomplete setup: retestBar=%s confirmBar=%s — trade blocked.",
                     i,
                     fvgZones[i].dir > 0 ? "BUY" : "SELL",
                     fvgZones[i].ul, fvgZones[i].ll,
                     fvgZones[i].retestBar  == 0 ? "MISSING" : TimeToString(fvgZones[i].retestBar,  TIME_DATE|TIME_MINUTES),
                     fvgZones[i].confirmBar == 0 ? "MISSING" : TimeToString(fvgZones[i].confirmBar, TIME_DATE|TIME_MINUTES));
         fvgZones[i].state = FVG_INVALID;
         continue;
      }

      if(fvgZones[i].dir > 0) // Bullish: BUY at bar open
      {
         double sl   = NormalizeDouble(fvgZones[i].retestLow - InpStopBuffer * point, digits);
         double dist = MathAbs(ask - sl) / point;
         if(dist < (double)stops) { fvgZones[i].state = FVG_INVALID; continue; }
         double lot  = CalcLot(dist, InpSymbol, InpRiskPercent);
         if(lot <= 0) { fvgZones[i].state = FVG_INVALID; continue; }
         double tp   = NormalizeDouble(ask + dist * InpRewardRisk * point, digits);

         PrintFormat("[FVG SETUP] id=%d | dir=BUY | UL=%.5f | LL=%.5f | "
                     "created=%s | retest=%s | confirmed=%s | entry=%s | "
                     "SL=%.5f | TP=%.5f | state=CONFIRMED | invalidated=false | traded=false",
                     i, fvgZones[i].ul, fvgZones[i].ll,
                     TimeToString(fvgZones[i].createdAt,  TIME_DATE|TIME_MINUTES),
                     TimeToString(fvgZones[i].retestBar,  TIME_DATE|TIME_MINUTES),
                     TimeToString(fvgZones[i].confirmBar, TIME_DATE|TIME_MINUTES),
                     TimeToString(entryBar,               TIME_DATE|TIME_MINUTES),
                     sl, tp);
         FVG_DrawTradeMarker(i, ask, sl, tp, entryBar);

         if(trade.Buy(lot, InpSymbol, ask, sl, tp, "FVG Buy"))
            fvgZones[i].state = FVG_TRADED;
      }
      else // Bearish: SELL at bar open
      {
         double sl   = NormalizeDouble(fvgZones[i].retestHigh + InpStopBuffer * point, digits);
         double dist = MathAbs(sl - bid) / point;
         if(dist < (double)stops) { fvgZones[i].state = FVG_INVALID; continue; }
         double lot  = CalcLot(dist, InpSymbol, InpRiskPercent);
         if(lot <= 0) { fvgZones[i].state = FVG_INVALID; continue; }
         double tp   = NormalizeDouble(bid - dist * InpRewardRisk * point, digits);

         PrintFormat("[FVG SETUP] id=%d | dir=SELL | UL=%.5f | LL=%.5f | "
                     "created=%s | retest=%s | confirmed=%s | entry=%s | "
                     "SL=%.5f | TP=%.5f | state=CONFIRMED | invalidated=false | traded=false",
                     i, fvgZones[i].ul, fvgZones[i].ll,
                     TimeToString(fvgZones[i].createdAt,  TIME_DATE|TIME_MINUTES),
                     TimeToString(fvgZones[i].retestBar,  TIME_DATE|TIME_MINUTES),
                     TimeToString(fvgZones[i].confirmBar, TIME_DATE|TIME_MINUTES),
                     TimeToString(entryBar,               TIME_DATE|TIME_MINUTES),
                     sl, tp);
         FVG_DrawTradeMarker(i, bid, sl, tp, entryBar);

         if(trade.Sell(lot, InpSymbol, bid, sl, tp, "FVG Sell"))
            fvgZones[i].state = FVG_TRADED;
      }
      break; // one trade per bar
   }
}

// Called every tick: move SL to break-even when profit >= InpBEAtR * initial risk.
void FVG_ManageBreakEven()
{
   double point  = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic)  continue;

      long   type = PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);   // preserve TP when moving SL to BE
      if(open <= 0 || sl <= 0) continue;

      double initRisk = MathAbs(open - sl);
      if(initRisk < point) continue;

      double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);

      if(type == POSITION_TYPE_BUY)
      {
         if(sl >= open - point) continue; // already at or above break-even
         if(bid - open >= initRisk * InpBEAtR)
            trade.PositionModify(ticket, NormalizeDouble(open, digits), tp);
      }
      else
      {
         if(sl <= open + point) continue; // already at or below break-even
         if(open - ask >= initRisk * InpBEAtR)
            trade.PositionModify(ticket, NormalizeDouble(open, digits), tp);
      }
   }
}

// Update chart rectangles for all non-expired zones.
void FVG_DrawZones()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "FVG_") == 0) ObjectDelete(0, nm);
   }
   for(int i = 0; i < fvgCount; i++)
   {
      int st = fvgZones[i].state;
      if(st == FVG_INVALID || st == FVG_TRADED) continue;
      string nm  = "FVG_" + IntegerToString(i);
      color  clr = (fvgZones[i].dir > 0)
                   ? (st == FVG_CONFIRMED ? clrGreen     : clrPaleGreen)
                   : (st == FVG_CONFIRMED ? clrRed       : clrLightCoral);
      datetime t1 = fvgZones[i].createdAt;
      datetime t2 = TimeCurrent() + (datetime)(PeriodSeconds(InpEntryTF) * 20);
      if(!ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, fvgZones[i].ul, t2, fvgZones[i].ll))
         continue;
      ObjectSetInteger(0, nm, OBJPROP_COLOR,     clr);
      ObjectSetInteger(0, nm, OBJPROP_BACK,       true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

// Delete all FVG chart objects — called from OnDeinit.
void FVG_DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      // Remove both zone rectangles (FVG_) and trade markers (FVGENTRY_)
      if(StringFind(nm, "FVG_") == 0 || StringFind(nm, "FVGENTRY_") == 0)
         ObjectDelete(0, nm);
   }
}

`;
}

// ─── OB State Machine generator ──────────────────────────────────────────────

function genOBStateMachine(ctx: Ctx): string {
  return `//+------------------------------------------------------------------+
//| OB State Machine                                                 |
//| Detects ATR-displacement Order Blocks, tracks retest/confirm,  |
//| enters on the bar AFTER confirmation (bar-open pattern).       |
//| States: ACTIVE -> RETESTED -> CONFIRMED -> TRADED               |
//|         Any live state -> MITIGATED / INVALIDATED / EXPIRED     |
//+------------------------------------------------------------------+

// Add a new OB zone. Dedup skips terminal zones; recycling reuses their slots.
void OB_Add(int dir, datetime obT, datetime dispT, double hi, double lo)
{
   for(int i = 0; i < obCount; i++)
   {
      if(obZones[i].state >= OB_TRADED) continue;
      if(obZones[i].dir == dir && obZones[i].obTime == obT) return;
   }
   int idx = -1;
   for(int i = 0; i < obCount; i++)
      if(obZones[i].state >= OB_TRADED) { idx = i; break; }
   if(idx < 0)
   {
      if(obCount >= MAX_OBS) return;
      idx = obCount++;
   }
   obZones[idx].hi          = hi;
   obZones[idx].lo          = lo;
   obZones[idx].dir         = dir;
   obZones[idx].obTime      = obT;
   obZones[idx].dispTime    = dispT;
   obZones[idx].state       = OB_ACTIVE;
   obZones[idx].retestLow   = lo;
   obZones[idx].retestHigh  = hi;
   obZones[idx].barsAlive   = 0;
   obZones[idx].retestBar   = 0;
   obZones[idx].confirmBar  = 0;
}

// Embedded ATR — no indicator handle needed, self-contained.
double OB_CalcATR(int shift)
{
   int avail = iBars(InpSymbol, InpEntryTF);
   if(shift + InpOBATRPeriod + 1 >= avail) return 0.0;
   double sum = 0.0;
   for(int k = 0; k < InpOBATRPeriod; k++)
   {
      double h  = iHigh (InpSymbol, InpEntryTF, shift + k);
      double l  = iLow  (InpSymbol, InpEntryTF, shift + k);
      double pc = iClose(InpSymbol, InpEntryTF, shift + k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / InpOBATRPeriod;
}

// Scan bar at dispShift: if body >= InpOBDispMult*ATR, look back for OB candle.
// Bullish displacement (close>open): last bearish candle before it = bullish OB.
// Bearish displacement (close<open): last bullish candle before it = bearish OB.
void OB_ScanBar(int dispShift)
{
   if(dispShift < 1) return;
   double atr = OB_CalcATR(dispShift);
   if(atr <= 0.0) return;
   double dispO = iOpen (InpSymbol, InpEntryTF, dispShift);
   double dispC = iClose(InpSymbol, InpEntryTF, dispShift);
   if(MathAbs(dispC - dispO) < InpOBDispMult * atr) return;
   int  dir     = (dispC > dispO) ? 1 : -1;
   int  avail   = iBars(InpSymbol, InpEntryTF);
   int  scanEnd = MathMin(dispShift + InpOBScanBack, avail - 2);
   for(int j = dispShift + 1; j <= scanEnd; j++)
   {
      double jO = iOpen (InpSymbol, InpEntryTF, j);
      double jC = iClose(InpSymbol, InpEntryTF, j);
      if(dir == 1 && jC < jO)   // bullish displacement → last bearish candle
      {
         OB_Add(1,
                iTime(InpSymbol, InpEntryTF, j),
                iTime(InpSymbol, InpEntryTF, dispShift),
                iHigh(InpSymbol, InpEntryTF, j),
                iLow (InpSymbol, InpEntryTF, j));
         break;
      }
      if(dir == -1 && jC > jO)  // bearish displacement → last bullish candle
      {
         OB_Add(-1,
                iTime(InpSymbol, InpEntryTF, j),
                iTime(InpSymbol, InpEntryTF, dispShift),
                iHigh(InpSymbol, InpEntryTF, j),
                iLow (InpSymbol, InpEntryTF, j));
         break;
      }
   }
}

// Called on each new bar: update state of all live zones using just-closed bar (shift 1).
void OB_Update()
{
   double   barHigh  = iHigh (InpSymbol, InpEntryTF, 1);
   double   barLow   = iLow  (InpSymbol, InpEntryTF, 1);
   double   barClose = iClose(InpSymbol, InpEntryTF, 1);
   datetime barT     = iTime (InpSymbol, InpEntryTF, 1);

   for(int i = 0; i < obCount; i++)
   {
      int st = obZones[i].state;
      if(st >= OB_TRADED) continue;             // skip all terminal states
      if(obZones[i].dispTime >= barT) continue; // zone not born yet

      obZones[i].barsAlive++;
      bool   isBull = (obZones[i].dir == 1);
      double hi     = obZones[i].hi;
      double lo     = obZones[i].lo;

      // 1. Expiry
      if(InpOBExpiry > 0 && obZones[i].barsAlive >= InpOBExpiry)
         { obZones[i].state = OB_EXPIRED; continue; }

      // 2. Invalidated — close beyond far edge (zone fully violated)
      //    Bull: close < lo   Bear: close > hi
      if((isBull && barClose < lo) || (!isBull && barClose > hi))
         { obZones[i].state = OB_INVALIDATED; continue; }

      // 3. Mitigated — close inside zone (partial fill)
      if(barClose >= lo && barClose <= hi)
         { obZones[i].state = OB_MITIGATED; continue; }

      // 4. Confirmed — from RETESTED, close exits from near edge
      //    Bull: close > hi   Bear: close < lo
      if(st == OB_RETESTED)
      {
         if((isBull && barClose > hi) || (!isBull && barClose < lo))
         {
            obZones[i].state      = OB_CONFIRMED;
            obZones[i].confirmBar = barT;
            continue;
         }
         // Still retesting — track worst wick for SL calculation
         if(barLow  < obZones[i].retestLow)  obZones[i].retestLow  = barLow;
         if(barHigh > obZones[i].retestHigh) obZones[i].retestHigh = barHigh;
         continue;
      }

      // 5. Retested — wick enters zone from correct side (from ACTIVE or CONFIRMED)
      //    Bull: barLow <= hi   Bear: barHigh >= lo
      bool retested = isBull ? (barLow <= hi) : (barHigh >= lo);
      if(retested)
      {
         obZones[i].state      = OB_RETESTED;
         obZones[i].retestBar  = barT;
         obZones[i].retestLow  = barLow;
         obZones[i].retestHigh = barHigh;
      }
   }
}

// Called at bar open: execute market entries for CONFIRMED zones.
void OB_ExecuteEntries()
{
   ${ctx.hasMaxTradesFilter
     ? `if(CountOpenPositions(InpSymbol, InpMagic) >= InpMaxTrades) return;`
     : `if(HasOpenPosition(InpSymbol, InpMagic)) return;`}
   if(!SpreadOk(InpSymbol, InpMaxSpread)) return;

   double   point    = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   double   ask      = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
   double   bid      = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   int      digits   = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   long     stops    = SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL);

   for(int i = 0; i < obCount; i++)
   {
      if(obZones[i].state != OB_CONFIRMED) continue;

      // Validation: both retestBar and confirmBar must have been recorded
      if(obZones[i].retestBar == 0 || obZones[i].confirmBar == 0)
         { obZones[i].state = OB_INVALIDATED; continue; }

      if(obZones[i].dir == 1) // Bullish OB → BUY at bar open
      {
         double sl   = NormalizeDouble(obZones[i].retestLow - InpStopBuffer * point, digits);
         double dist = (ask - sl) / point;
         if(dist < (double)stops) { obZones[i].state = OB_INVALIDATED; continue; }
         double lot  = CalcLot(dist, InpSymbol, InpRiskPercent);
         if(lot <= 0) { obZones[i].state = OB_INVALIDATED; continue; }
         double tp   = NormalizeDouble(ask + dist * InpRewardRisk * point, digits);
         PrintFormat("[OB SETUP] id=%d | dir=BUY  | hi=%.5f | lo=%.5f | retest=%s | confirm=%s | SL=%.5f | TP=%.5f",
                     i, obZones[i].hi, obZones[i].lo,
                     TimeToString(obZones[i].retestBar,  TIME_DATE|TIME_MINUTES),
                     TimeToString(obZones[i].confirmBar, TIME_DATE|TIME_MINUTES), sl, tp);
         if(trade.Buy(lot, InpSymbol, ask, sl, tp, "OB Buy"))
            obZones[i].state = OB_TRADED;
      }
      else // Bearish OB → SELL at bar open
      {
         double sl   = NormalizeDouble(obZones[i].retestHigh + InpStopBuffer * point, digits);
         double dist = (sl - bid) / point;
         if(dist < (double)stops) { obZones[i].state = OB_INVALIDATED; continue; }
         double lot  = CalcLot(dist, InpSymbol, InpRiskPercent);
         if(lot <= 0) { obZones[i].state = OB_INVALIDATED; continue; }
         double tp   = NormalizeDouble(bid - dist * InpRewardRisk * point, digits);
         PrintFormat("[OB SETUP] id=%d | dir=SELL | hi=%.5f | lo=%.5f | retest=%s | confirm=%s | SL=%.5f | TP=%.5f",
                     i, obZones[i].hi, obZones[i].lo,
                     TimeToString(obZones[i].retestBar,  TIME_DATE|TIME_MINUTES),
                     TimeToString(obZones[i].confirmBar, TIME_DATE|TIME_MINUTES), sl, tp);
         if(trade.Sell(lot, InpSymbol, bid, sl, tp, "OB Sell"))
            obZones[i].state = OB_TRADED;
      }
      break; // one trade per bar
   }
}

// Called every tick: move SL to break-even when profit >= InpBEAtR × initial risk.
void OB_ManageBreakEven()
{
   double point  = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic)  continue;
      long   type = PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      if(open <= 0 || sl <= 0) continue;
      double initRisk = MathAbs(open - sl);
      if(initRisk < point) continue;
      double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
      if(type == POSITION_TYPE_BUY)
      {
         if(sl >= open - point) continue;
         if(bid - open >= initRisk * InpBEAtR)
            trade.PositionModify(ticket, NormalizeDouble(open, digits), tp);
      }
      else
      {
         if(sl <= open + point) continue;
         if(open - ask >= initRisk * InpBEAtR)
            trade.PositionModify(ticket, NormalizeDouble(open, digits), tp);
      }
   }
}

// Draw zone rectangles for ACTIVE / RETESTED / CONFIRMED OBs.
void OB_DrawZones()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "OBZ_") == 0) ObjectDelete(0, nm);
   }
   for(int i = 0; i < obCount; i++)
   {
      int st = obZones[i].state;
      if(st >= OB_TRADED) continue;
      string nm  = "OBZ_" + IntegerToString(i);
      color  clr = (obZones[i].dir == 1)
                   ? (st == OB_CONFIRMED ? clrLimeGreen  : (st == OB_RETESTED ? clrGold : clrRoyalBlue))
                   : (st == OB_CONFIRMED ? clrOrangeRed  : (st == OB_RETESTED ? clrGold : clrCrimson));
      datetime t1 = obZones[i].obTime;
      datetime t2 = TimeCurrent() + (datetime)(PeriodSeconds(InpEntryTF) * 20);
      if(!ObjectCreate(0, nm, OBJ_RECTANGLE, 0, t1, obZones[i].hi, t2, obZones[i].lo)) continue;
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, nm, OBJPROP_BACK,       true);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

// Delete all OB chart objects — called from OnDeinit.
void OB_DeleteAllObjects()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "OBZ_") == 0) ObjectDelete(0, nm);
   }
}

`;
}

// ─── Strategy helpers (strategy-type driven) ──────────────────────────────────

function genStrategyHelpers(bp: StrategyBlueprint, ctx: Ctx): string {
  const parts: string[] = [];

  // ── Session filter ──────────────────────────────────────────────────────────
  if (ctx.hasSession) {
    parts.push(`bool IsSessionActive()
{
   MqlDateTime t; TimeToStruct(TimeCurrent(), t);
   int h = t.hour;
   if(InpSessionStart <= InpSessionEnd) return h >= InpSessionStart && h < InpSessionEnd;
   return h >= InpSessionStart || h < InpSessionEnd;
}

`);
  }

  // ── HTF trend ───────────────────────────────────────────────────────────────
  if (ctx.hasHTF) {
    parts.push(`// Returns +1 = up, -1 = down, 0 = flat
int HTFTrend()
{
   double v1 = IndVal(hHTF, 0, 1), v2 = IndVal(hHTF, 0, 2);
   if(v1 <= 0 || v2 <= 0) return 0;
   if(v1 > v2) return  1;
   if(v1 < v2) return -1;
   return 0;
}

`);
  }

  // ── Candle pattern helpers ──────────────────────────────────────────────────
  if (ctx.hasEngulfing || ctx.hasPinBar || ctx.hasInsideBar || ctx.hasHammer) {
    parts.push(`bool IsBullishEngulfing(int sh)
{
   double o1=iOpen(InpSymbol,InpEntryTF,sh),  c1=iClose(InpSymbol,InpEntryTF,sh);
   double o2=iOpen(InpSymbol,InpEntryTF,sh+1),c2=iClose(InpSymbol,InpEntryTF,sh+1);
   if(o1<=0||c2<=0) return false;
   return c2<o2 && c1>o1 && o1<=c2 && c1>=o2;
}
bool IsBearishEngulfing(int sh)
{
   double o1=iOpen(InpSymbol,InpEntryTF,sh),  c1=iClose(InpSymbol,InpEntryTF,sh);
   double o2=iOpen(InpSymbol,InpEntryTF,sh+1),c2=iClose(InpSymbol,InpEntryTF,sh+1);
   if(o1<=0||c2<=0) return false;
   return c2>o2 && c1<o1 && o1>=c2 && c1<=o2;
}
bool IsBullishPinBar(int sh)
{
   double o=iOpen(InpSymbol,InpEntryTF,sh),c=iClose(InpSymbol,InpEntryTF,sh);
   double h=iHigh(InpSymbol,InpEntryTF,sh),l=iLow(InpSymbol,InpEntryTF,sh);
   if(h<=l) return false;
   double rng=h-l, body=MathAbs(c-o), lwick=MathMin(o,c)-l;
   return lwick>=rng*0.6 && body<=rng*0.35;
}
bool IsBearishPinBar(int sh)
{
   double o=iOpen(InpSymbol,InpEntryTF,sh),c=iClose(InpSymbol,InpEntryTF,sh);
   double h=iHigh(InpSymbol,InpEntryTF,sh),l=iLow(InpSymbol,InpEntryTF,sh);
   if(h<=l) return false;
   double rng=h-l, body=MathAbs(c-o), uwick=h-MathMax(o,c);
   return uwick>=rng*0.6 && body<=rng*0.35;
}
bool IsInsideBar(int sh)
{
   double mH=iHigh(InpSymbol,InpEntryTF,sh+1), mL=iLow(InpSymbol,InpEntryTF,sh+1);
   double iH=iHigh(InpSymbol,InpEntryTF,sh),   iL=iLow(InpSymbol,InpEntryTF,sh);
   return iH<mH && iL>mL;
}
bool IsHammer(int sh)    { return IsBullishPinBar(sh); }
bool IsShootingStar(int sh) { return IsBearishPinBar(sh); }

`);
  }

  // ── SMC helpers ─────────────────────────────────────────────────────────────
  if (ctx.hasBOS) {
    parts.push(`// BOS / CHoCH: close breaks beyond the highest high or lowest low of last N bars
bool IsBullishBOS()
{
   double highest = iHigh(InpSymbol, InpEntryTF, 2);
   for(int i = 3; i <= InpBOSLookback; i++)
   {
      double h = iHigh(InpSymbol, InpEntryTF, i);
      if(h > highest) highest = h;
   }
   return iClose(InpSymbol, InpEntryTF, 1) > highest;
}
bool IsBearishBOS()
{
   double lowest = iLow(InpSymbol, InpEntryTF, 2);
   for(int i = 3; i <= InpBOSLookback; i++)
   {
      double l = iLow(InpSymbol, InpEntryTF, i);
      if(l < lowest) lowest = l;
   }
   return iClose(InpSymbol, InpEntryTF, 1) < lowest;
}

`);
  }

  if (ctx.hasFVG) {
    // Full state machine: FVG_Add, FVG_Detect, FVG_Update,
    // FVG_ExecuteEntries, FVG_ManageBreakEven, FVG_DrawZones, FVG_DeleteAllObjects
    parts.push(genFVGStateMachine(ctx));
  }

  if (ctx.hasOrderBlock) {
    parts.push(genOBStateMachine(ctx));
  }

  if (ctx.hasLiquiditySweep) {
    parts.push(`// Liquidity Sweep: candle sweeps a recent extreme and closes back inside
bool IsBullishLiquiditySweep()
{
   double swingLow = iLow(InpSymbol, InpEntryTF, 2);
   for(int i = 3; i <= InpLiqLookback; i++)
   {
      double l = iLow(InpSymbol, InpEntryTF, i);
      if(l < swingLow) swingLow = l;
   }
   double low1   = iLow(InpSymbol, InpEntryTF, 1);
   double close1 = iClose(InpSymbol, InpEntryTF, 1);
   return low1 < swingLow && close1 > swingLow;
}
bool IsBearishLiquiditySweep()
{
   double swingHigh = iHigh(InpSymbol, InpEntryTF, 2);
   for(int i = 3; i <= InpLiqLookback; i++)
   {
      double h = iHigh(InpSymbol, InpEntryTF, i);
      if(h > swingHigh) swingHigh = h;
   }
   double high1  = iHigh(InpSymbol, InpEntryTF, 1);
   double close1 = iClose(InpSymbol, InpEntryTF, 1);
   return high1 > swingHigh && close1 < swingHigh;
}

`);
  }

  if (ctx.hasZone) {
    parts.push(`// Demand / Supply zone: price touches the zone (recent swing low/high range)
// Buy near demand zone (lowest low range), sell near supply zone (highest high range)
bool IsNearDemandZone()
{
   double zoneLow  = iLow(InpSymbol, InpEntryTF, 1);
   double recentLow = zoneLow;
   for(int i = 2; i <= 20; i++)
   {
      double l = iLow(InpSymbol, InpEntryTF, i);
      if(l < recentLow) recentLow = l;
   }
   double point = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   return MathAbs(iClose(InpSymbol, InpEntryTF, 1) - recentLow) <= 50 * point;
}
bool IsNearSupplyZone()
{
   double recentHigh = iHigh(InpSymbol, InpEntryTF, 1);
   for(int i = 2; i <= 20; i++)
   {
      double h = iHigh(InpSymbol, InpEntryTF, i);
      if(h > recentHigh) recentHigh = h;
   }
   double point = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   return MathAbs(iClose(InpSymbol, InpEntryTF, 1) - recentHigh) <= 50 * point;
}

`);
  }

  // ── Stop-loss calculator ────────────────────────────────────────────────────
  // FVG mode computes SL inline inside FVG_ExecuteEntries() — CalcSL is unused there.
  if (!ctx.hasFVG) {
    if (ctx.stopType === "atr_based" && ctx.hasATR) {
      parts.push(`double CalcSL(int dir, int sh)
{
   double atr = IndVal(hATR, 0, sh);
   if(atr <= 0) atr = 50 * SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(dir > 0) return iLow(InpSymbol, InpEntryTF, sh)  - atr * InpATRMult;
   return              iHigh(InpSymbol, InpEntryTF, sh) + atr * InpATRMult;
}

`);
    } else {
      parts.push(`double CalcSL(int dir, int sh)
{
   double buf = InpStopBuffer * SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   if(dir > 0) return iLow(InpSymbol, InpEntryTF, sh)  - buf;
   return              iHigh(InpSymbol, InpEntryTF, sh) + buf;
}

`);
    }
  }

  // ── Break-even ──────────────────────────────────────────────────────────────
  // FVG mode uses FVG_ManageBreakEven() — the generic version is unused and skipped.
  if (!ctx.hasFVG && bp.risk.breakevenEnabled) {
    parts.push(`void ManageBreakEven()
{
   double point  = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   int    digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC)  != InpMagic)  continue;
      long   type = PositionGetInteger(POSITION_TYPE);
      double open = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl   = PositionGetDouble(POSITION_SL);
      double tp   = PositionGetDouble(POSITION_TP);
      if(tp <= 0 || open <= 0) continue;
      double initR = MathAbs(tp - open) / InpRewardRisk;
      if(initR < point) continue;
      double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
      double move = (type == POSITION_TYPE_BUY) ? bid - open : open - ask;
      if(move < initR * InpBEAtR) continue;
      if(type == POSITION_TYPE_BUY  && sl >= open - point) continue;
      if(type == POSITION_TYPE_SELL && sl <= open + point) continue;
      trade.PositionModify(ticket, NormalizeDouble(open, digits), tp);
   }
}

`);
  }

  // State-machine strategies drive entries through their own Execute function.
  // CheckEntrySignal is not used — return early before it is generated.
  if (ctx.hasFVG || ctx.hasOrderBlock) return parts.join("");

  // ── Entry signal ─────────────────────────────────────────────────────────────
  // Collect trigger conditions (OR'd — any can fire)
  const buyTriggers: string[] = [];
  const sellTriggers: string[] = [];
  // Collect filter conditions (AND'd — all must pass)
  const buyFilters: string[] = [];
  const sellFilters: string[] = [];
  const preamble: string[] = [];
  const todoLines: string[] = [];

  // ── TRIGGER: EMA cross
  if (ctx.hasEMA && findRule(bp.rules, "ema_cross", "sma_cross", "ema_touch")) {
    preamble.push(
      `   double fNow=IndVal(hFastMA,0,1), sNow=IndVal(hSlowMA,0,1);`,
      `   double fPrv=IndVal(hFastMA,0,2), sPrv=IndVal(hSlowMA,0,2);`,
    );
    buyTriggers.push(`(fNow>0 && fPrv<=sPrv && fNow>sNow)` );  // golden cross
    sellTriggers.push(`(fNow>0 && fPrv>=sPrv && fNow<sNow)`);  // death cross
  }

  // ── FILTER: EMA alignment (fast above/below slow, no cross required)
  if (ctx.hasEMA && findRule(bp.rules, "ema_alignment", "ema_band")) {
    if (!preamble.includes(`   double fNow=IndVal(hFastMA,0,1), sNow=IndVal(hSlowMA,0,1);`)) {
      preamble.push(
        `   double fNow=IndVal(hFastMA,0,1), sNow=IndVal(hSlowMA,0,1);`,
      );
    }
    buyFilters.push(`fNow>sNow`);
    sellFilters.push(`fNow<sNow`);
  }

  // ── TRIGGER: RSI extreme
  if (findRule(bp.rules, "rsi_overbought", "rsi_oversold")) {
    preamble.push(`   double rsiVal=IndVal(hRSI,0,1);`);
    buyTriggers.push(`(rsiVal>0 && rsiVal<=InpRSIBuyMax)`);
    sellTriggers.push(`(rsiVal>0 && rsiVal>=InpRSISellMin)`);
  } else if (ctx.hasRSI) {
    // rsi_level used as filter
    preamble.push(`   double rsiVal=IndVal(hRSI,0,1);`);
    buyFilters.push(`(rsiVal>0 && rsiVal<50)`);
    sellFilters.push(`(rsiVal>0 && rsiVal>50)`);
  }

  // ── TRIGGER: MACD cross / histogram
  if (ctx.hasMACD) {
    preamble.push(
      `   double mHist1=IndVal(hMACD,2,1), mHist2=IndVal(hMACD,2,2);`,
    );
    if (findRule(bp.rules, "macd_cross", "macd_signal")) {
      buyTriggers.push(`(mHist2<=0 && mHist1>0)` );  // crosses above zero
      sellTriggers.push(`(mHist2>=0 && mHist1<0)`);  // crosses below zero
    } else {
      buyTriggers.push(`(mHist1>mHist2 && mHist1>0)`);  // histogram rising & positive
      sellTriggers.push(`(mHist1<mHist2 && mHist1<0)`); // histogram falling & negative
    }
  }

  // ── TRIGGER: Bollinger touch / breakout
  if (ctx.hasBB) {
    preamble.push(
      `   double bbU=IndVal(hBB,1,1), bbL=IndVal(hBB,2,1);`,
      `   double bbClose=iClose(InpSymbol,InpEntryTF,1);`,
    );
    buyTriggers.push(`(bbL>0 && bbClose<=bbL)`);
    sellTriggers.push(`(bbU>0 && bbClose>=bbU)`);
  }

  // ── TRIGGER: Stochastic cross
  if (ctx.hasStoch && findRule(bp.rules, "stochastic_cross")) {
    preamble.push(
      `   double stK1=IndVal(hStoch,0,1), stK2=IndVal(hStoch,0,2);`,
      `   double stD1=IndVal(hStoch,1,1);`,
    );
    buyTriggers.push(`(stK2<stD1 && stK1>stD1 && stK1<=InpStochBuyMax)` );  // %K crosses %D up in oversold
    sellTriggers.push(`(stK2>stD1 && stK1<stD1 && stK1>=InpStochSellMin)`); // %K crosses %D down in overbought
  } else if (ctx.hasStoch) {
    preamble.push(`   double stK1=IndVal(hStoch,0,1);`);
    buyFilters.push(`(stK1>0 && stK1<=InpStochBuyMax)`);
    sellFilters.push(`(stK1>0 && stK1>=InpStochSellMin)`);
  }

  // ── TRIGGER: SMC — BOS / CHoCH
  if (ctx.hasBOS) {
    buyTriggers.push(`IsBullishBOS()`);
    sellTriggers.push(`IsBearishBOS()`);
  }

  // ── FVG entries are handled by FVG_ExecuteEntries() in OnTick — not via CheckEntrySignal

  // ── TRIGGER: SMC — Order Block
  if (ctx.hasOrderBlock) {
    buyTriggers.push(`IsBullishOrderBlock()`);
    sellTriggers.push(`IsBearishOrderBlock()`);
  }

  // ── TRIGGER: SMC — Liquidity Sweep
  if (ctx.hasLiquiditySweep) {
    buyTriggers.push(`IsBullishLiquiditySweep()`);
    sellTriggers.push(`IsBearishLiquiditySweep()`);
  }

  // ── TRIGGER: SMC — Demand/Supply zone
  if (ctx.hasZone) {
    buyTriggers.push(`IsNearDemandZone()`);
    sellTriggers.push(`IsNearSupplyZone()`);
  }

  // ── TRIGGER: Candle patterns
  if (ctx.hasEngulfing) {
    buyTriggers.push(`IsBullishEngulfing(1)`);
    sellTriggers.push(`IsBearishEngulfing(1)`);
  }
  if (ctx.hasPinBar) {
    buyTriggers.push(`IsBullishPinBar(1)`);
    sellTriggers.push(`IsBearishPinBar(1)`);
  }
  if (ctx.hasInsideBar) {
    // Inside bar: direction from EMA alignment or HTF trend
    buyTriggers.push(`(IsInsideBar(1) && (fNow>sNow || HTFTrend()>0))`);
    sellTriggers.push(`(IsInsideBar(1) && (fNow<sNow || HTFTrend()<0))`);
  }
  if (ctx.hasHammer) {
    buyTriggers.push(`IsHammer(1)`);
    sellTriggers.push(`IsShootingStar(1)`);
  }

  // ── FILTER: ADX
  if (ctx.hasADX) {
    preamble.push(`   double adxVal=IndVal(hADX,0,1);`);
    buyFilters.push(`adxVal>=InpADXMin`);
    sellFilters.push(`adxVal>=InpADXMin`);
  }

  // ── FILTER: HTF trend
  if (ctx.hasHTF) {
    preamble.push(`   int htfDir=HTFTrend();`);
    buyFilters.push(`htfDir>=0`);
    sellFilters.push(`htfDir<=0`);
  }

  // ── FILTER: Session
  if (ctx.hasSession) {
    buyFilters.push(`IsSessionActive()`);
    sellFilters.push(`IsSessionActive()`);
  }

  // Note: unsupported rules are surfaced in the interview UI via analyzeBuildability()
  // BEFORE code generation. Here we just note them as comments so the file is honest.
  for (const rule of bp.rules) {
    if (!SUPPORTED_RULE_TYPES.has(rule.type)) {
      todoLines.push(
        `   // UNSUPPORTED [${rule.type}]: ${rule.label}`,
        `   //   → Refine this rule in the interview to map it to a supported primitive.`,
      );
    }
  }

  // If no triggers were generated, fall back to a safe always-false stub with clear message
  if (buyTriggers.length === 0) {
    buyTriggers.push(`false /* No supported trigger rules found — add your entry logic here */`);
    sellTriggers.push(`false /* No supported trigger rules found — add your entry logic here */`);
  }

  // Compose buy / sell condition strings
  const buyTrig  = buyTriggers.map((c, i)  => (i === 0 ? `   (${c}` : `   || ${c}`)).join("\n") + `)`;
  const sellTrig = sellTriggers.map((c, i) => (i === 0 ? `   (${c}` : `   || ${c}`)).join("\n") + `)`;
  const buyFilt  = buyFilters.length  > 0 ? `\n   && ` + buyFilters.join("\n   && ")  : "";
  const sellFilt = sellFilters.length > 0 ? `\n   && ` + sellFilters.join("\n   && ") : "";

  const pre  = preamble.length  > 0 ? preamble.join("\n")  + "\n\n" : "";
  const todos = todoLines.length > 0 ? todoLines.join("\n") + "\n\n" : "";

  parts.push(`// Returns +1 (buy), -1 (sell), or 0 (no signal).
// Writes the recommended stop-loss price into slPrice.
int CheckEntrySignal(double &slPrice)
{
${pre}${todos}   bool buyOk =
${buyTrig}${buyFilt};

   bool sellOk =
${sellTrig}${sellFilt};

   if(buyOk)  { slPrice = CalcSL( 1, 1); return  1; }
   if(sellOk) { slPrice = CalcSL(-1, 1); return -1; }
   return 0;
}

`);

  return parts.join("");
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

function genOnInit(bp: StrategyBlueprint, ctx: Ctx): string {
  const lines: string[] = [
    `int OnInit()`,
    `{`,
    `   trade.SetExpertMagicNumber((ulong)InpMagic);`,
    `   trade.SetTypeFillingBySymbol(InpSymbol);`,
    ``,
  ];
  // _Symbol is always available — SymbolSelect would be redundant and generates a warning
  // on some brokers. Only validate when the user specified an explicit symbol string.
  if (!ctx.useChartSymbol) {
    lines.push(
      `   if(!SymbolSelect(InpSymbol, true))`,
      `   { PrintFormat("Symbol %s not available", InpSymbol); return INIT_FAILED; }`,
      ``,
    );
  }

  if (ctx.hasEMA) {
    lines.push(`   hFastMA = iMA(InpSymbol, InpEntryTF, InpFastMA, 0, MODE_EMA, PRICE_CLOSE);`);
    lines.push(`   hSlowMA = iMA(InpSymbol, InpEntryTF, InpSlowMA, 0, MODE_EMA, PRICE_CLOSE);`);
    if (ctx.useSetupTF) {
      lines.push(`   hFastSetup = iMA(InpSymbol, InpSetupTF, InpFastMA, 0, MODE_EMA, PRICE_CLOSE);`);
      lines.push(`   hSlowSetup = iMA(InpSymbol, InpSetupTF, InpSlowMA, 0, MODE_EMA, PRICE_CLOSE);`);
    }
    lines.push(`   if(hFastMA==INVALID_HANDLE||hSlowMA==INVALID_HANDLE) { Print("MA handle failed"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasRSI) {
    lines.push(`   hRSI = iRSI(InpSymbol, InpEntryTF, InpRSIPeriod, PRICE_CLOSE);`);
    lines.push(`   if(hRSI==INVALID_HANDLE) { Print("RSI handle failed"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasMACD) {
    lines.push(`   hMACD = iMACD(InpSymbol, InpEntryTF, InpMACDFast, InpMACDSlow, InpMACDSignal, PRICE_CLOSE);`);
    lines.push(`   if(hMACD==INVALID_HANDLE) { Print("MACD handle failed"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasADX) {
    lines.push(`   hADX = iADX(InpSymbol, InpEntryTF, InpADXPeriod);`);
    lines.push(`   if(hADX==INVALID_HANDLE) { Print("ADX handle failed"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasBB) {
    lines.push(`   hBB = iBands(InpSymbol, InpEntryTF, InpBBPeriod, 0, InpBBDev, PRICE_CLOSE);`);
    lines.push(`   if(hBB==INVALID_HANDLE) { Print("Bollinger handle failed"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasStoch) {
    lines.push(`   hStoch = iStochastic(InpSymbol, InpEntryTF, InpStochK, InpStochD, InpStochSlowing, MODE_SMA, STO_LOWHIGH);`);
    lines.push(`   if(hStoch==INVALID_HANDLE) { Print("Stochastic handle failed"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasATR) {
    lines.push(`   hATR = iATR(InpSymbol, InpEntryTF, InpATRPeriod);`);
    lines.push(`   if(hATR==INVALID_HANDLE) { Print("ATR handle failed"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasHTF) {
    lines.push(`   hHTF = iMA(InpSymbol, InpSetupTF, InpHTFPeriod, 0, MODE_EMA, PRICE_CLOSE);`);
    lines.push(`   if(hHTF==INVALID_HANDLE) { Print("HTF handle failed"); return INIT_FAILED; }`);
    lines.push(``);
  }

  lines.push(`   return INIT_SUCCEEDED;`, `}`, ``);
  return lines.join("\n") + "\n";
}

function genOnDeinit(ctx: Ctx): string {
  const rel: string[] = [];
  if (ctx.hasEMA) {
    rel.push(`   if(hFastMA!=INVALID_HANDLE) IndicatorRelease(hFastMA);`);
    rel.push(`   if(hSlowMA!=INVALID_HANDLE) IndicatorRelease(hSlowMA);`);
    if (ctx.useSetupTF) {
      rel.push(`   if(hFastSetup!=INVALID_HANDLE) IndicatorRelease(hFastSetup);`);
      rel.push(`   if(hSlowSetup!=INVALID_HANDLE) IndicatorRelease(hSlowSetup);`);
    }
  }
  if (ctx.hasRSI)   rel.push(`   if(hRSI  !=INVALID_HANDLE) IndicatorRelease(hRSI);`);
  if (ctx.hasMACD)  rel.push(`   if(hMACD !=INVALID_HANDLE) IndicatorRelease(hMACD);`);
  if (ctx.hasADX)   rel.push(`   if(hADX  !=INVALID_HANDLE) IndicatorRelease(hADX);`);
  if (ctx.hasBB)    rel.push(`   if(hBB   !=INVALID_HANDLE) IndicatorRelease(hBB);`);
  if (ctx.hasStoch) rel.push(`   if(hStoch!=INVALID_HANDLE) IndicatorRelease(hStoch);`);
  if (ctx.hasATR)   rel.push(`   if(hATR  !=INVALID_HANDLE) IndicatorRelease(hATR);`);
  if (ctx.hasHTF)   rel.push(`   if(hHTF  !=INVALID_HANDLE) IndicatorRelease(hHTF);`);
  if (ctx.hasFVG)        rel.push(`   FVG_DeleteAllObjects();`);
  if (ctx.hasOrderBlock) rel.push(`   OB_DeleteAllObjects();`);

  return `void OnDeinit(const int reason)
{
${rel.join("\n")}
}

`;
}

function genOnTick(bp: StrategyBlueprint, ctx: Ctx): string {
  // State-machine strategies use a dedicated OnTick.
  if (ctx.hasFVG) {
    return `void OnTick()
{
   FVG_ManageBreakEven(); // Move SL to break-even at 0.5R every tick

   // Bar-open pattern: run state machine on first tick of each new bar only
   datetime bar = iTime(InpSymbol, InpEntryTF, 0);
   if(bar == lastBarTime) return;
   lastBarTime = bar;

   FVG_Update();         // 1. Confirm/reject zones using the just-closed bar
   FVG_ExecuteEntries(); // 2. Enter at the new bar's open — zones are already updated
   FVG_Detect();         // 3. Identify new FVGs in the latest 3 bars
   FVG_DrawZones();      // 4. Refresh chart rectangle objects
}

`;
  }

  if (ctx.hasOrderBlock) {
    return `void OnTick()
{
   OB_ManageBreakEven(); // Move SL to break-even at 0.5R every tick

   // Bar-open pattern: run state machine on first tick of each new bar only
   datetime bar = iTime(InpSymbol, InpEntryTF, 0);
   if(bar == lastBarTime) return;
   lastBarTime = bar;

   OB_Update();          // 1. Update zone states using the just-closed bar
   OB_ExecuteEntries();  // 2. Enter at the new bar's open for CONFIRMED zones
   OB_ScanBar(1);        // 3. Scan just-closed bar for new OBs
   OB_DrawZones();       // 4. Refresh chart rectangle objects
}

`;
  }

  const lines: string[] = [`void OnTick()`, `{`];

  if (bp.risk.breakevenEnabled) {
    lines.push(`   ManageBreakEven();`, ``);
  }

  lines.push(
    `   // Bar-open pattern: run logic only on the first tick of a new candle`,
    `   datetime bar = iTime(InpSymbol, InpEntryTF, 0);`,
    `   if(bar == lastBarTime) return;`,
    `   lastBarTime = bar;`,
    ``,
    ctx.hasMaxTradesFilter
      ? `   if(CountOpenPositions(InpSymbol, InpMagic) >= InpMaxTrades) return;`
      : `   if(HasOpenPosition(InpSymbol, InpMagic)) return;`,
    `   if(!SpreadOk(InpSymbol, InpMaxSpread))   return;`,
    ``,
    `   double slPrice = 0.0;`,
    `   int signal = CheckEntrySignal(slPrice);`,
    `   if(signal == 0) return;`,
    ``,
    `   double point  = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);`,
    `   double ask    = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);`,
    `   double bid    = SymbolInfoDouble(InpSymbol, SYMBOL_BID);`,
    `   int    digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);`,
    `   long   stops  = SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL);`,
    ``,
    `   if(signal > 0)`,
    `   {`,
    `      double sl  = NormalizeDouble(slPrice, digits);`,
    `      double dist = (ask - sl) / point;`,
    `      if(dist < stops) return;`,
    `      double tp  = NormalizeDouble(ask + (ask - sl) * InpRewardRisk, digits);`,
    `      double lot = CalcLot(dist, InpSymbol, InpRiskPercent);`,
    `      if(lot <= 0) return;`,
    `      trade.Buy(lot, InpSymbol, ask, sl, tp, "EA Builder Buy");`,
    `   }`,
    `   else`,
    `   {`,
    `      double sl  = NormalizeDouble(slPrice, digits);`,
    `      double dist = (sl - bid) / point;`,
    `      if(dist < stops) return;`,
    `      double tp  = NormalizeDouble(bid - (sl - bid) * InpRewardRisk, digits);`,
    `      double lot = CalcLot(dist, InpSymbol, InpRiskPercent);`,
    `      if(lot <= 0) return;`,
    `      trade.Sell(lot, InpSymbol, bid, sl, tp, "EA Builder Sell");`,
    `   }`,
    `}`,
    ``,
  );
  return lines.join("\n") + "\n";
}

function genRulesBlock(bp: StrategyBlueprint): string {
  const lines = [
    `//+------------------------------------------------------------------+`,
    `//| Blueprint rules`,
    `//+------------------------------------------------------------------+`,
  ];
  for (const rule of bp.rules) {
    const tag = rule.compilable ? "compiled" : "subjective";
    lines.push(`// [${tag}] ${rule.type} (${rule.side}): ${rule.label}`);
    if (rule.mql5Hint)      lines.push(`//   hint: ${rule.mql5Hint}`);
    if (rule.subjectiveNote) lines.push(`//   note: ${rule.subjectiveNote}`);
  }
  if (bp.pendingClarifications.length > 0) {
    lines.push(`//`, `// Pending clarifications:`);
    bp.pendingClarifications.forEach((q, i) => lines.push(`//   ${i + 1}. ${q}`));
  }
  lines.push(`//+------------------------------------------------------------------+`, ``);
  return lines.join("\n") + "\n";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a complete, always-compilable MQL5 EA from a StrategyBlueprint.
 * Pure TypeScript → MQL5. No API calls. Instant.
 *
 * Supports: EMA/SMA, RSI, MACD, ADX, Bollinger, Stochastic, ATR,
 *           BOS/CHoCH, FVG, Order Blocks, Liquidity Sweeps,
 *           Demand/Supply Zones, session filters, HTF trend filter,
 *           engulfing, pin bar, inside bar, hammer, shooting star.
 */
export function generateMql5FromBlueprint(bp: StrategyBlueprint): string {
  const ctx = analyze(bp);
  return [
    genHeader(bp),
    genInputs(bp, ctx),
    genGlobals(ctx),
    genRulesBlock(bp),
    genHelpers(),
    genStrategyHelpers(bp, ctx),
    genOnInit(bp, ctx),
    genOnDeinit(ctx),
    genOnTick(bp, ctx),
  ].join("");
}
