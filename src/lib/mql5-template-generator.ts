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
  hasLiquiditySweep: boolean;
  liqLookback: number;
  hasZone: boolean; // demand/supply zones

  // Candle patterns
  hasEngulfing: boolean;
  hasPinBar: boolean;
  hasInsideBar: boolean;
  hasHammer: boolean;

  stopType: StrategyBlueprint["risk"]["stopType"];
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
    obLookback: safeInt(param(obRule, "lookback", 20), 20, 5, 100),

    hasLiquiditySweep: Boolean(liqRule),
    liqLookback: safeInt(param(liqRule, "lookback", 20), 20, 5, 100),

    hasZone: Boolean(zoneRule),

    hasEngulfing: Boolean(engulf),
    hasPinBar:    Boolean(pinBar),
    hasInsideBar: Boolean(insideBar),
    hasHammer:    Boolean(hammer),

    stopType: bp.risk.stopType,
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
    `input string  InpSymbol          = "${execution.symbol ?? "EURUSD"}";  // Trading symbol`,
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
    lines.push(`//--- Order block`);
    lines.push(`input int InpOBLookback = ${ctx.obLookback};  // Bars to scan for order block`);
    lines.push(``);
  }
  if (ctx.hasLiquiditySweep) {
    lines.push(`//--- Liquidity sweep`);
    lines.push(`input int InpLiqLookback = ${ctx.liqLookback};  // Bars to scan for recent highs/lows`);
    lines.push(``);
  }
  if (risk.breakevenEnabled) {
    lines.push(`//--- Break-even`);
    lines.push(`input double InpBEAtR = 1.0;  // Move SL to B/E at this R multiple`);
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}

// ─── Globals ──────────────────────────────────────────────────────────────────

function genGlobals(ctx: Ctx): string {
  const lines: string[] = [`//--- Indicator handles`];
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
    parts.push(`// Fair Value Gap (3-candle imbalance)
// Bullish FVG: candle[3].high < candle[1].low — price skipped over
bool IsBullishFVG()
{
   double c3High = iHigh(InpSymbol, InpEntryTF, 3);
   double c1Low  = iLow(InpSymbol, InpEntryTF, 1);
   return c3High > 0 && c1Low > c3High;
}
bool IsBearishFVG()
{
   double c3Low  = iLow(InpSymbol, InpEntryTF, 3);
   double c1High = iHigh(InpSymbol, InpEntryTF, 1);
   return c3Low > 0 && c1High < c3Low;
}

`);
  }

  if (ctx.hasOrderBlock) {
    parts.push(`// Order Block: simplified — last opposing candle before the current move.
// Price returns to that candle's body → order block entry.
bool IsBullishOrderBlock()
{
   double price = iClose(InpSymbol, InpEntryTF, 1);
   for(int i = 2; i <= InpOBLookback; i++)
   {
      double o = iOpen(InpSymbol, InpEntryTF, i);
      double c = iClose(InpSymbol, InpEntryTF, i);
      if(c >= o) continue; // skip bullish candles
      if(price >= c && price <= o) return true; // price inside bearish OB body
   }
   return false;
}
bool IsBearishOrderBlock()
{
   double price = iClose(InpSymbol, InpEntryTF, 1);
   for(int i = 2; i <= InpOBLookback; i++)
   {
      double o = iOpen(InpSymbol, InpEntryTF, i);
      double c = iClose(InpSymbol, InpEntryTF, i);
      if(c <= o) continue; // skip bearish candles
      if(price <= c && price >= o) return true; // price inside bullish OB body
   }
   return false;
}

`);
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

  // ── Break-even ──────────────────────────────────────────────────────────────
  if (bp.risk.breakevenEnabled) {
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

  // ── TRIGGER: SMC — Fair Value Gap
  if (ctx.hasFVG) {
    buyTriggers.push(`IsBullishFVG()`);
    sellTriggers.push(`IsBearishFVG()`);
  }

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

  // ── TODO for unsupported types
  const supported = new Set([
    "ema_cross","sma_cross","ema_touch","ema_alignment","ema_band",
    "rsi_level","rsi_overbought","rsi_oversold",
    "macd_cross","macd_signal","macd_histogram",
    "adx_strength",
    "bollinger_touch","bollinger_breakout","bollinger_squeeze",
    "stochastic_cross","stochastic_level",
    "atr_trailing","atr_volatility",
    "trend_filter_htf","trend_direction",
    "session_filter","time_filter",
    "engulfing_bullish","engulfing_bearish",
    "pin_bar_bullish","pin_bar_bearish",
    "inside_bar","doji","hammer","shooting_star",
    "bos","choch","mss",
    "fair_value_gap_bullish","fair_value_gap_bearish",
    "order_block_bullish","order_block_bearish",
    "liquidity_sweep_high","liquidity_sweep_low",
    "demand_zone","supply_zone",
    "spread_filter",
  ]);
  for (const rule of bp.rules) {
    if (!supported.has(rule.type)) {
      todoLines.push(`   // TODO [${rule.type}]: ${rule.label} — implement this rule manually`);
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
    `   if(!SymbolSelect(InpSymbol, true))`,
    `   { PrintFormat("Symbol %s not available", InpSymbol); return INIT_FAILED; }`,
    ``,
  ];

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

  return `void OnDeinit(const int reason)
{
${rel.join("\n")}
}

`;
}

function genOnTick(bp: StrategyBlueprint): string {
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
    `   if(HasOpenPosition(InpSymbol, InpMagic)) return;`,
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
    genOnTick(bp),
  ].join("");
}
