/**
 * Deterministic MQL5 EA generator — always produces compilable output.
 * No AI involved. Reads a StrategyBlueprint and emits proven MQL5 patterns.
 *
 * Supported rule types (generate real code):
 *   ema_cross, sma_cross, ema_touch, ema_alignment
 *   rsi_level, rsi_overbought, rsi_oversold
 *   macd_cross, macd_histogram, macd_signal
 *   adx_strength
 *   bollinger_touch, bollinger_breakout
 *   stochastic_cross, stochastic_level
 *   session_filter, time_filter
 *   trend_filter_htf, trend_direction
 *   engulfing_bullish, engulfing_bearish
 *   pin_bar_bullish, pin_bar_bearish
 *   atr_trailing, atr_volatility
 *
 * All other rule types emit a // TODO comment and are skipped at runtime.
 */

import type { StrategyBlueprint, NormalizedRule } from "@/types/blueprint";

// ─── Blueprint analysis ───────────────────────────────────────────────────────

function findRule(rules: NormalizedRule[], ...types: string[]): NormalizedRule | undefined {
  return rules.find((r) => types.includes(r.type));
}

function p<T>(rule: NormalizedRule | undefined, key: string, fallback: T): T {
  if (!rule) return fallback;
  const v = rule.parameters?.[key];
  return v !== undefined ? (v as T) : fallback;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function safeInt(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  return isNaN(n) ? fallback : clamp(Math.round(n), lo, hi);
}

function safeFloat(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = Number(v);
  return isNaN(n) ? fallback : clamp(n, lo, hi);
}

function tfConst(tf: string): string {
  const u = tf.toUpperCase();
  if (u === "MN") return "PERIOD_MN1";
  return `PERIOD_${u}`;
}

interface Ctx {
  // EMA / SMA
  hasEMA: boolean;
  fastPeriod: number;
  slowPeriod: number;
  useSetupTF: boolean;

  // RSI
  hasRSI: boolean;
  rsiPeriod: number;
  rsiBuyMax: number;   // buy only when RSI < this
  rsiSellMin: number;  // sell only when RSI > this

  // MACD
  hasMACD: boolean;
  macdFast: number;
  macdSlow: number;
  macdSig: number;

  // ADX
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

  // ATR (for trailing / stop sizing)
  hasATR: boolean;
  atrPeriod: number;
  atrMult: number;

  // HTF trend filter
  hasHTF: boolean;
  htfPeriod: number;

  // Session filter
  hasSession: boolean;
  sessionStart: number;
  sessionEnd: number;

  // Candle patterns
  hasEngulfing: boolean;
  hasPinBar: boolean;

  // Stop type
  stopType: StrategyBlueprint["risk"]["stopType"];
}

function analyze(bp: StrategyBlueprint): Ctx {
  const r = bp.rules;
  const emaRule = findRule(r, "ema_cross", "sma_cross", "ema_touch", "ema_alignment", "ema_band");
  const rsiRule = findRule(r, "rsi_level", "rsi_overbought", "rsi_oversold", "rsi_divergence");
  const macdRule = findRule(r, "macd_cross", "macd_signal", "macd_histogram");
  const adxRule = findRule(r, "adx_strength");
  const bbRule = findRule(r, "bollinger_touch", "bollinger_breakout", "bollinger_squeeze");
  const stochRule = findRule(r, "stochastic_cross", "stochastic_level");
  const atrRule = findRule(r, "atr_trailing", "atr_volatility");
  const htfRule = findRule(r, "trend_filter_htf", "trend_direction");
  const sessionRule = findRule(r, "session_filter", "time_filter");
  const engulfRule = findRule(r, "engulfing_bullish", "engulfing_bearish");
  const pinRule = findRule(r, "pin_bar_bullish", "pin_bar_bearish");

  const fastDefault = 9;
  const slowDefault = 21;

  const fast = safeInt(
    p(emaRule, "fastPeriod", p(emaRule, "fast", fastDefault)),
    fastDefault, 2, 500,
  );
  const slow = safeInt(
    p(emaRule, "slowPeriod", p(emaRule, "slow", slowDefault)),
    slowDefault, 2, 500,
  );

  return {
    hasEMA: Boolean(emaRule),
    fastPeriod: fast,
    slowPeriod: Math.max(fast + 1, slow),
    useSetupTF: bp.execution.setupTimeframe !== bp.execution.entryTimeframe,

    hasRSI: Boolean(rsiRule),
    rsiPeriod: safeInt(p(rsiRule, "period", 14), 14, 2, 100),
    rsiBuyMax: safeInt(p(rsiRule, "oversoldLevel", p(rsiRule, "level", 50)), 50, 10, 90),
    rsiSellMin: safeInt(p(rsiRule, "overboughtLevel", p(rsiRule, "level", 50)), 50, 10, 90),

    hasMACD: Boolean(macdRule),
    macdFast: safeInt(p(macdRule, "fastPeriod", p(macdRule, "fast", 12)), 12, 2, 200),
    macdSlow: safeInt(p(macdRule, "slowPeriod", p(macdRule, "slow", 26)), 26, 2, 500),
    macdSig: safeInt(p(macdRule, "signalPeriod", p(macdRule, "signal", 9)), 9, 1, 100),

    hasADX: Boolean(adxRule),
    adxPeriod: safeInt(p(adxRule, "period", 14), 14, 2, 100),
    adxMin: safeInt(p(adxRule, "minStrength", p(adxRule, "threshold", 25)), 25, 1, 100),

    hasBB: Boolean(bbRule),
    bbPeriod: safeInt(p(bbRule, "period", 20), 20, 2, 500),
    bbDev: safeFloat(p(bbRule, "deviation", p(bbRule, "stdDev", 2.0)), 2.0, 0.1, 5.0),

    hasStoch: Boolean(stochRule),
    stochK: safeInt(p(stochRule, "kPeriod", p(stochRule, "k", 5)), 5, 1, 100),
    stochD: safeInt(p(stochRule, "dPeriod", p(stochRule, "d", 3)), 3, 1, 100),
    stochSlowing: safeInt(p(stochRule, "slowing", 3), 3, 1, 100),
    stochBuyMax: safeInt(p(stochRule, "oversoldLevel", p(stochRule, "level", 30)), 30, 5, 50),
    stochSellMin: safeInt(p(stochRule, "overboughtLevel", p(stochRule, "level", 70)), 70, 50, 95),

    hasATR: Boolean(atrRule) || bp.risk.stopType === "atr_based",
    atrPeriod: safeInt(p(atrRule, "period", 14), 14, 1, 100),
    atrMult: safeFloat(p(atrRule, "multiplier", 2.0), 2.0, 0.1, 10.0),

    hasHTF: Boolean(htfRule),
    htfPeriod: safeInt(p(htfRule, "period", p(htfRule, "maPeriod", slow)), slow, 2, 500),

    hasSession: Boolean(sessionRule) || bp.execution.sessionFilter.length > 0,
    sessionStart: safeInt(
      sessionRule
        ? p(sessionRule, "startHour", p(sessionRule, "start", 8))
        : (bp.execution.sessionFilter[0] ? 8 : 0),
      8, 0, 23,
    ),
    sessionEnd: safeInt(
      sessionRule
        ? p(sessionRule, "endHour", p(sessionRule, "end", 17))
        : (bp.execution.sessionFilter[0] ? 17 : 23),
      17, 0, 23,
    ),

    hasEngulfing: Boolean(engulfRule),
    hasPinBar: Boolean(pinRule),

    stopType: bp.risk.stopType,
  };
}

// ─── Code generation helpers ──────────────────────────────────────────────────

function ln(s = "") {
  return s + "\n";
}

function block(...lines: string[]) {
  return lines.join("\n") + "\n";
}

// ─── Section generators ───────────────────────────────────────────────────────

function genHeader(bp: StrategyBlueprint): string {
  const safeName = (bp.name || "EA_Builder_Strategy").replace(/[^\w\s-]/g, "").trim();
  return block(
    `//+------------------------------------------------------------------+`,
    `//| ${safeName}.mq5`,
    `//| Generated by EA Builder (template mode — always compiles)`,
    `//| Strategy: ${safeName}`,
    `//|`,
    `//| DISCLAIMER: Generated code is provided for research and educational`,
    `//| use only. Always forward-test on a demo account before live trading.`,
    `//+------------------------------------------------------------------+`,
    `#property copyright "EA Builder"`,
    `#property version   "1.00"`,
    `#property strict`,
    ``,
    `#include <Trade/Trade.mqh>`,
    `CTrade trade;`,
    ``,
  );
}

function genInputs(bp: StrategyBlueprint, ctx: Ctx): string {
  const { risk, execution } = bp;
  const lines: string[] = [`//--- General inputs`];

  lines.push(`input string  InpSymbol           = "${execution.symbol}";         // Trading symbol`);
  lines.push(`input ENUM_TIMEFRAMES InpSetupTF  = ${tfConst(execution.setupTimeframe)};    // Setup timeframe`);
  lines.push(`input ENUM_TIMEFRAMES InpEntryTF  = ${tfConst(execution.entryTimeframe)};    // Entry timeframe`);
  lines.push(``);
  lines.push(`//--- Risk`);
  lines.push(`input double  InpRiskPercent       = ${risk.riskPercent};           // Risk per trade (% of equity)`);
  lines.push(`input double  InpRewardRisk        = ${risk.rewardRisk};            // Reward:risk ratio`);
  lines.push(`input int     InpStopBufferPoints  = ${risk.stopBufferPoints};      // Stop buffer (points)`);
  lines.push(`input int     InpMaxSpreadPoints   = ${execution.spreadFilterPoints}; // Max spread (points, 0=off)`);
  lines.push(`input int     InpSetupExpiryBars   = ${execution.setupExpiryBars};  // Bars before setup expires`);
  lines.push(`input long    InpMagic             = ${execution.magicNumber};      // EA magic number`);
  lines.push(``);

  if (ctx.hasEMA) {
    lines.push(`//--- EMA`);
    lines.push(`input int     InpFastEMA           = ${ctx.fastPeriod};            // Fast EMA period`);
    lines.push(`input int     InpSlowEMA           = ${ctx.slowPeriod};            // Slow EMA period`);
    lines.push(``);
  }

  if (ctx.hasRSI) {
    lines.push(`//--- RSI filter`);
    lines.push(`input int     InpRSIPeriod         = ${ctx.rsiPeriod};             // RSI period`);
    lines.push(`input int     InpRSIBuyMax         = ${ctx.rsiBuyMax};             // RSI max for buy entries`);
    lines.push(`input int     InpRSISellMin        = ${ctx.rsiSellMin};            // RSI min for sell entries`);
    lines.push(``);
  }

  if (ctx.hasMACD) {
    lines.push(`//--- MACD`);
    lines.push(`input int     InpMACDFast          = ${ctx.macdFast};              // MACD fast EMA`);
    lines.push(`input int     InpMACDSlow          = ${ctx.macdSlow};              // MACD slow EMA`);
    lines.push(`input int     InpMACDSignal        = ${ctx.macdSig};               // MACD signal`);
    lines.push(``);
  }

  if (ctx.hasADX) {
    lines.push(`//--- ADX trend filter`);
    lines.push(`input int     InpADXPeriod         = ${ctx.adxPeriod};             // ADX period`);
    lines.push(`input int     InpADXMin            = ${ctx.adxMin};                // Min ADX for trend entries`);
    lines.push(``);
  }

  if (ctx.hasBB) {
    lines.push(`//--- Bollinger Bands`);
    lines.push(`input int     InpBBPeriod          = ${ctx.bbPeriod};              // Bollinger period`);
    lines.push(`input double  InpBBDeviation       = ${ctx.bbDev};                 // Bollinger std-dev`);
    lines.push(``);
  }

  if (ctx.hasStoch) {
    lines.push(`//--- Stochastic`);
    lines.push(`input int     InpStochK            = ${ctx.stochK};                // Stochastic %K`);
    lines.push(`input int     InpStochD            = ${ctx.stochD};                // Stochastic %D`);
    lines.push(`input int     InpStochSlowing      = ${ctx.stochSlowing};          // Stochastic slowing`);
    lines.push(`input int     InpStochBuyMax       = ${ctx.stochBuyMax};           // Stoch max for buy`);
    lines.push(`input int     InpStochSellMin      = ${ctx.stochSellMin};          // Stoch min for sell`);
    lines.push(``);
  }

  if (ctx.hasATR) {
    lines.push(`//--- ATR (stop sizing)`);
    lines.push(`input int     InpATRPeriod         = ${ctx.atrPeriod};             // ATR period`);
    lines.push(`input double  InpATRMult           = ${ctx.atrMult};               // ATR stop multiplier`);
    lines.push(``);
  }

  if (ctx.hasHTF) {
    lines.push(`//--- Higher-timeframe trend filter`);
    lines.push(`input int     InpHTFPeriod         = ${ctx.htfPeriod};             // HTF EMA period`);
    lines.push(``);
  }

  if (ctx.hasSession) {
    lines.push(`//--- Session filter`);
    lines.push(`input int     InpSessionStart      = ${ctx.sessionStart};          // Session start hour (server time)`);
    lines.push(`input int     InpSessionEnd        = ${ctx.sessionEnd};            // Session end hour (server time)`);
    lines.push(``);
  }

  if (risk.breakevenEnabled) {
    lines.push(`//--- Trailing / break-even`);
    lines.push(`input double  InpBreakEvenR        = 1.0;                         // Move SL to B/E at this R:R`);
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}

function genGlobals(ctx: Ctx): string {
  const lines: string[] = [`//--- Indicator handles`];

  if (ctx.hasEMA) {
    lines.push(`int hFastEMA = INVALID_HANDLE;`);
    lines.push(`int hSlowEMA = INVALID_HANDLE;`);
    if (ctx.useSetupTF) {
      lines.push(`int hFastSetup = INVALID_HANDLE;`);
      lines.push(`int hSlowSetup = INVALID_HANDLE;`);
    }
  }
  if (ctx.hasRSI)   lines.push(`int hRSI     = INVALID_HANDLE;`);
  if (ctx.hasMACD)  lines.push(`int hMACD    = INVALID_HANDLE;`);
  if (ctx.hasADX)   lines.push(`int hADX     = INVALID_HANDLE;`);
  if (ctx.hasBB)    lines.push(`int hBB      = INVALID_HANDLE;`);
  if (ctx.hasStoch) lines.push(`int hStoch   = INVALID_HANDLE;`);
  if (ctx.hasATR)   lines.push(`int hATR     = INVALID_HANDLE;`);
  if (ctx.hasHTF)   lines.push(`int hHTF     = INVALID_HANDLE;`);

  lines.push(``);
  lines.push(`static datetime lastBarTime = 0;`);
  lines.push(``);

  return lines.join("\n") + "\n";
}

function genHelpers(): string {
  return `//+------------------------------------------------------------------+
//| Proven helper functions — do not modify                          |
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
   int digits = 0;
   double step = lotStep;
   while(step < 1.0 && digits < 8) { step *= 10.0; digits++; }
   return NormalizeDouble(volume, digits);
}

double CalcLot(double stopDistancePoints, string symbol, double riskPercent)
{
   if(stopDistancePoints <= 0) return 0.0;
   double equity    = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskMoney = equity * (riskPercent / 100.0);
   double tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickValue <= 0) tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_PROFIT);
   if(tickValue <= 0) tickValue = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   double tickSize  = SymbolInfoDouble(symbol, SYMBOL_TRADE_TICK_SIZE);
   double point     = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(tickValue <= 0 || tickSize <= 0 || point <= 0) return 0.0;
   double lossPerLot = (stopDistancePoints * point / tickSize) * tickValue;
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
         PositionGetInteger(POSITION_MAGIC)  == magic)
         return true;
   }
   return false;
}

bool SpreadOk(string symbol, int maxSpreadPoints)
{
   if(maxSpreadPoints <= 0) return true;
   return (int)SymbolInfoInteger(symbol, SYMBOL_SPREAD) <= maxSpreadPoints;
}

double IndicatorValue(int handle, int bufferIndex, int shift)
{
   if(handle == INVALID_HANDLE) return 0.0;
   double buf[];
   ArraySetAsSeries(buf, true);
   if(CopyBuffer(handle, bufferIndex, shift, 1, buf) != 1) return 0.0;
   return buf[0];
}

`;
}

function genStrategyHelpers(bp: StrategyBlueprint, ctx: Ctx): string {
  const parts: string[] = [];

  // ── Session filter ──────────────────────────────────────────────────────────
  if (ctx.hasSession) {
    parts.push(`bool IsSessionActive()
{
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   int h = t.hour;
   if(InpSessionStart <= InpSessionEnd)
      return h >= InpSessionStart && h < InpSessionEnd;
   return h >= InpSessionStart || h < InpSessionEnd; // overnight session
}

`);
  }

  // ── HTF trend filter ────────────────────────────────────────────────────────
  if (ctx.hasHTF) {
    parts.push(`int HTFTrend()
{
   if(hHTF == INVALID_HANDLE) return 0;
   double htfFast1 = IndicatorValue(hHTF, 0, 1);
   double htfFast2 = IndicatorValue(hHTF, 0, 2);
   if(htfFast1 <= 0 || htfFast2 <= 0) return 0;
   if(htfFast1 > htfFast2) return 1;   // uptrend
   if(htfFast1 < htfFast2) return -1;  // downtrend
   return 0;
}

`);
  }

  // ── Candle pattern helpers ──────────────────────────────────────────────────
  if (ctx.hasEngulfing || ctx.hasPinBar) {
    parts.push(`bool IsBullishEngulfing(int shift)
{
   double open1  = iOpen(InpSymbol, InpEntryTF, shift);
   double close1 = iClose(InpSymbol, InpEntryTF, shift);
   double open2  = iOpen(InpSymbol, InpEntryTF, shift + 1);
   double close2 = iClose(InpSymbol, InpEntryTF, shift + 1);
   if(open1 <= 0 || close2 <= 0) return false;
   return close2 < open2 && close1 > open1 && open1 < close2 && close1 > open2;
}

bool IsBearishEngulfing(int shift)
{
   double open1  = iOpen(InpSymbol, InpEntryTF, shift);
   double close1 = iClose(InpSymbol, InpEntryTF, shift);
   double open2  = iOpen(InpSymbol, InpEntryTF, shift + 1);
   double close2 = iClose(InpSymbol, InpEntryTF, shift + 1);
   if(open1 <= 0 || close2 <= 0) return false;
   return close2 > open2 && close1 < open1 && open1 > close2 && close1 < open2;
}

bool IsBullishPinBar(int shift)
{
   double open  = iOpen(InpSymbol, InpEntryTF, shift);
   double close = iClose(InpSymbol, InpEntryTF, shift);
   double high  = iHigh(InpSymbol, InpEntryTF, shift);
   double low   = iLow(InpSymbol, InpEntryTF, shift);
   if(high <= low) return false;
   double body   = MathAbs(close - open);
   double range  = high - low;
   double lowerWick = MathMin(open, close) - low;
   return lowerWick >= range * 0.6 && body <= range * 0.3;
}

bool IsBearishPinBar(int shift)
{
   double open  = iOpen(InpSymbol, InpEntryTF, shift);
   double close = iClose(InpSymbol, InpEntryTF, shift);
   double high  = iHigh(InpSymbol, InpEntryTF, shift);
   double low   = iLow(InpSymbol, InpEntryTF, shift);
   if(high <= low) return false;
   double body      = MathAbs(close - open);
   double range     = high - low;
   double upperWick = high - MathMax(open, close);
   return upperWick >= range * 0.6 && body <= range * 0.3;
}

`);
  }

  // ── Stop loss calculator ────────────────────────────────────────────────────
  parts.push(`double CalcStopLoss(int direction, int candleShift)
{
   double point  = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   double buffer = InpStopBufferPoints * point;
`);

  if (ctx.stopType === "atr_based" && ctx.hasATR) {
    parts.push(
      `   double atr = IndicatorValue(hATR, 0, candleShift);
   if(atr <= 0) atr = 50 * point;
   if(direction > 0) return iLow(InpSymbol, InpEntryTF, candleShift) - atr * InpATRMult;
   return iHigh(InpSymbol, InpEntryTF, candleShift) + atr * InpATRMult;
}

`,
    );
  } else {
    // candle_extreme (default)
    parts.push(
      `   if(direction > 0) return iLow(InpSymbol, InpEntryTF, candleShift)  - buffer;
   return                       iHigh(InpSymbol, InpEntryTF, candleShift) + buffer;
}

`,
    );
  }

  // ── Break-even manager ──────────────────────────────────────────────────────
  if (bp.risk.breakevenEnabled) {
    parts.push(`void ManageBreakEven()
{
   double point = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(!PositionSelectByTicket(ticket)) continue;
      if(PositionGetString(POSITION_SYMBOL) != InpSymbol) continue;
      if(PositionGetInteger(POSITION_MAGIC)  != InpMagic)  continue;

      long   type  = PositionGetInteger(POSITION_TYPE);
      double open  = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl    = PositionGetDouble(POSITION_SL);
      double tp    = PositionGetDouble(POSITION_TP);
      if(tp <= 0 || open <= 0) continue;

      double initialRisk = MathAbs(tp - open) / InpRewardRisk;
      if(initialRisk < point) continue;

      double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
      double move = (type == POSITION_TYPE_BUY) ? bid - open : open - ask;

      if(move < initialRisk * InpBreakEvenR) continue;
      if(type == POSITION_TYPE_BUY  && sl >= open - point) continue;
      if(type == POSITION_TYPE_SELL && sl <= open + point) continue;

      trade.PositionModify(ticket, NormalizeDouble(open, (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS)), tp);
   }
}

`);
  }

  // ── Entry signal ─────────────────────────────────────────────────────────────
  // Build buy / sell conditions
  const buyCondParts: string[] = [];
  const sellCondParts: string[] = [];
  const preambleLines: string[] = [];
  const todoLines: string[] = [];

  // EMA-based primary signal
  if (ctx.hasEMA) {
    preambleLines.push(
      `   double fastNow  = IndicatorValue(hFastEMA, 0, 1);`,
      `   double slowNow  = IndicatorValue(hSlowEMA, 0, 1);`,
      `   double fastPrev = IndicatorValue(hFastEMA, 0, 2);`,
      `   double slowPrev = IndicatorValue(hSlowEMA, 0, 2);`,
      `   if(fastNow == 0 || slowNow == 0) return 0;`,
    );
    buyCondParts.push(`fastPrev <= slowPrev && fastNow > slowNow`);   // golden cross
    sellCondParts.push(`fastPrev >= slowPrev && fastNow < slowNow`);  // death cross
  } else {
    // No EMA rule — use a simple price action placeholder so code still compiles
    preambleLines.push(`   // No EMA rule detected — using price-closes-above/below recent high/low`);
    preambleLines.push(`   double prevHigh = iHigh(InpSymbol, InpEntryTF, 2);`);
    preambleLines.push(`   double prevLow  = iLow(InpSymbol, InpEntryTF, 2);`);
    preambleLines.push(`   double barClose = iClose(InpSymbol, InpEntryTF, 1);`);
    preambleLines.push(`   if(prevHigh <= 0 || prevLow <= 0 || barClose <= 0) return 0;`);
    buyCondParts.push(`barClose > prevHigh`);
    sellCondParts.push(`barClose < prevLow`);
  }

  // RSI filter
  if (ctx.hasRSI) {
    preambleLines.push(`   double rsiVal = IndicatorValue(hRSI, 0, 1);`);
    buyCondParts.push(`rsiVal > 0 && rsiVal < InpRSIBuyMax`);
    sellCondParts.push(`rsiVal > 0 && rsiVal > InpRSISellMin`);
  }

  // MACD filter (histogram direction)
  if (ctx.hasMACD) {
    preambleLines.push(`   double macdHist1 = IndicatorValue(hMACD, 2, 1);`);
    preambleLines.push(`   double macdHist2 = IndicatorValue(hMACD, 2, 2);`);
    buyCondParts.push(`macdHist1 > macdHist2`);
    sellCondParts.push(`macdHist1 < macdHist2`);
  }

  // ADX filter
  if (ctx.hasADX) {
    preambleLines.push(`   double adxVal = IndicatorValue(hADX, 0, 1);`);
    buyCondParts.push(`adxVal >= InpADXMin`);
    sellCondParts.push(`adxVal >= InpADXMin`);
  }

  // Bollinger touch
  if (ctx.hasBB) {
    preambleLines.push(`   double bbUpper = IndicatorValue(hBB, 1, 1);`);
    preambleLines.push(`   double bbLower = IndicatorValue(hBB, 2, 1);`);
    preambleLines.push(`   double bbClose = iClose(InpSymbol, InpEntryTF, 1);`);
    buyCondParts.push(`bbLower > 0 && bbClose <= bbLower`);
    sellCondParts.push(`bbUpper > 0 && bbClose >= bbUpper`);
  }

  // Stochastic
  if (ctx.hasStoch) {
    preambleLines.push(`   double stochK1 = IndicatorValue(hStoch, 0, 1);`);
    preambleLines.push(`   double stochK2 = IndicatorValue(hStoch, 0, 2);`);
    buyCondParts.push(`stochK1 > 0 && stochK1 < InpStochBuyMax`);
    sellCondParts.push(`stochK1 > 0 && stochK1 > InpStochSellMin`);
  }

  // HTF trend
  if (ctx.hasHTF) {
    preambleLines.push(`   int htfTrend = HTFTrend();`);
    buyCondParts.push(`htfTrend >= 0`);
    sellCondParts.push(`htfTrend <= 0`);
  }

  // Session
  if (ctx.hasSession) {
    buyCondParts.push(`IsSessionActive()`);
    sellCondParts.push(`IsSessionActive()`);
  }

  // Candle patterns (additional confirmation)
  if (ctx.hasEngulfing) {
    buyCondParts.push(`IsBullishEngulfing(1)`);
    sellCondParts.push(`IsBearishEngulfing(1)`);
  }
  if (ctx.hasPinBar) {
    buyCondParts.push(`IsBullishPinBar(1)`);
    sellCondParts.push(`IsBearishPinBar(1)`);
  }

  // TODO comments for unsupported rules
  const supportedTypes = new Set([
    "ema_cross","sma_cross","ema_touch","ema_alignment","ema_band",
    "rsi_level","rsi_overbought","rsi_oversold","rsi_divergence",
    "macd_cross","macd_signal","macd_histogram",
    "adx_strength",
    "bollinger_touch","bollinger_breakout","bollinger_squeeze",
    "stochastic_cross","stochastic_level",
    "atr_trailing","atr_volatility",
    "trend_filter_htf","trend_direction",
    "session_filter","time_filter",
    "engulfing_bullish","engulfing_bearish",
    "pin_bar_bullish","pin_bar_bearish",
    "spread_filter",
  ]);
  for (const rule of bp.rules) {
    if (!supportedTypes.has(rule.type)) {
      todoLines.push(`   // TODO [${rule.type}]: ${rule.label} — implement manually`);
    }
  }

  const buyExpr = buyCondParts.length > 0
    ? buyCondParts.map((c, i) => (i === 0 ? `      ${c}` : `      && ${c}`)).join("\n")
    : `      false // No buy conditions extracted`;

  const sellExpr = sellCondParts.length > 0
    ? sellCondParts.map((c, i) => (i === 0 ? `      ${c}` : `      && ${c}`)).join("\n")
    : `      false // No sell conditions extracted`;

  const preamble = preambleLines.length > 0 ? preambleLines.join("\n") + "\n" : "";
  const todos = todoLines.length > 0 ? "\n" + todoLines.join("\n") + "\n" : "";

  parts.push(`// Returns +1 for buy signal, -1 for sell signal, 0 for no signal.
// Writes the stop-loss price into slPrice.
int CheckEntrySignal(double &slPrice)
{
${preamble}${todos}
   bool buyOk  =
${buyExpr};

   bool sellOk =
${sellExpr};

   if(buyOk)
   {
      slPrice = CalcStopLoss(1, 1);
      return 1;
   }
   if(sellOk)
   {
      slPrice = CalcStopLoss(-1, 1);
      return -1;
   }
   return 0;
}

`);

  return parts.join("");
}

function genOnInit(bp: StrategyBlueprint, ctx: Ctx): string {
  const lines: string[] = [];
  lines.push(`int OnInit()`);
  lines.push(`{`);
  lines.push(`   trade.SetExpertMagicNumber((ulong)InpMagic);`);
  lines.push(`   trade.SetTypeFillingBySymbol(InpSymbol);`);
  lines.push(``);
  lines.push(`   if(!SymbolSelect(InpSymbol, true))`);
  lines.push(`   {`);
  lines.push(`      PrintFormat("Symbol %s not available in Market Watch", InpSymbol);`);
  lines.push(`      return INIT_FAILED;`);
  lines.push(`   }`);
  lines.push(``);

  if (ctx.hasEMA) {
    lines.push(`   hFastEMA = iMA(InpSymbol, InpEntryTF, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE);`);
    lines.push(`   hSlowEMA = iMA(InpSymbol, InpEntryTF, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE);`);
    if (ctx.useSetupTF) {
      lines.push(`   hFastSetup = iMA(InpSymbol, InpSetupTF, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE);`);
      lines.push(`   hSlowSetup = iMA(InpSymbol, InpSetupTF, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE);`);
    }
    lines.push(`   if(hFastEMA == INVALID_HANDLE || hSlowEMA == INVALID_HANDLE)`);
    lines.push(`   { Print("Failed to create EMA handles"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasRSI) {
    lines.push(`   hRSI = iRSI(InpSymbol, InpEntryTF, InpRSIPeriod, PRICE_CLOSE);`);
    lines.push(`   if(hRSI == INVALID_HANDLE) { Print("Failed to create RSI handle"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasMACD) {
    lines.push(`   hMACD = iMACD(InpSymbol, InpEntryTF, InpMACDFast, InpMACDSlow, InpMACDSignal, PRICE_CLOSE);`);
    lines.push(`   if(hMACD == INVALID_HANDLE) { Print("Failed to create MACD handle"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasADX) {
    lines.push(`   hADX = iADX(InpSymbol, InpEntryTF, InpADXPeriod);`);
    lines.push(`   if(hADX == INVALID_HANDLE) { Print("Failed to create ADX handle"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasBB) {
    lines.push(`   hBB = iBands(InpSymbol, InpEntryTF, InpBBPeriod, 0, InpBBDeviation, PRICE_CLOSE);`);
    lines.push(`   if(hBB == INVALID_HANDLE) { Print("Failed to create Bollinger handle"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasStoch) {
    lines.push(`   hStoch = iStochastic(InpSymbol, InpEntryTF, InpStochK, InpStochD, InpStochSlowing, MODE_SMA, STO_LOWHIGH);`);
    lines.push(`   if(hStoch == INVALID_HANDLE) { Print("Failed to create Stochastic handle"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasATR) {
    lines.push(`   hATR = iATR(InpSymbol, InpEntryTF, InpATRPeriod);`);
    lines.push(`   if(hATR == INVALID_HANDLE) { Print("Failed to create ATR handle"); return INIT_FAILED; }`);
    lines.push(``);
  }
  if (ctx.hasHTF) {
    lines.push(`   hHTF = iMA(InpSymbol, InpSetupTF, InpHTFPeriod, 0, MODE_EMA, PRICE_CLOSE);`);
    lines.push(`   if(hHTF == INVALID_HANDLE) { Print("Failed to create HTF EMA handle"); return INIT_FAILED; }`);
    lines.push(``);
  }

  lines.push(`   return INIT_SUCCEEDED;`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n") + "\n";
}

function genOnDeinit(ctx: Ctx): string {
  const releases: string[] = [];
  if (ctx.hasEMA) {
    releases.push(`   if(hFastEMA  != INVALID_HANDLE) IndicatorRelease(hFastEMA);`);
    releases.push(`   if(hSlowEMA  != INVALID_HANDLE) IndicatorRelease(hSlowEMA);`);
    if (ctx.useSetupTF) {
      releases.push(`   if(hFastSetup != INVALID_HANDLE) IndicatorRelease(hFastSetup);`);
      releases.push(`   if(hSlowSetup != INVALID_HANDLE) IndicatorRelease(hSlowSetup);`);
    }
  }
  if (ctx.hasRSI)   releases.push(`   if(hRSI   != INVALID_HANDLE) IndicatorRelease(hRSI);`);
  if (ctx.hasMACD)  releases.push(`   if(hMACD  != INVALID_HANDLE) IndicatorRelease(hMACD);`);
  if (ctx.hasADX)   releases.push(`   if(hADX   != INVALID_HANDLE) IndicatorRelease(hADX);`);
  if (ctx.hasBB)    releases.push(`   if(hBB    != INVALID_HANDLE) IndicatorRelease(hBB);`);
  if (ctx.hasStoch) releases.push(`   if(hStoch != INVALID_HANDLE) IndicatorRelease(hStoch);`);
  if (ctx.hasATR)   releases.push(`   if(hATR   != INVALID_HANDLE) IndicatorRelease(hATR);`);
  if (ctx.hasHTF)   releases.push(`   if(hHTF   != INVALID_HANDLE) IndicatorRelease(hHTF);`);

  return `void OnDeinit(const int reason)
{
${releases.join("\n")}
}

`;
}

function genOnTick(bp: StrategyBlueprint, ctx: Ctx): string {
  const lines: string[] = [];
  lines.push(`void OnTick()`);
  lines.push(`{`);

  if (bp.risk.breakevenEnabled) {
    lines.push(`   ManageBreakEven();`);
    lines.push(``);
  }

  lines.push(`   // Execute only on the first tick of a new bar (bar-open pattern)`);
  lines.push(`   datetime currentBar = iTime(InpSymbol, InpEntryTF, 0);`);
  lines.push(`   if(currentBar == lastBarTime) return;`);
  lines.push(`   lastBarTime = currentBar;`);
  lines.push(``);
  lines.push(`   if(HasOpenPosition(InpSymbol, InpMagic)) return;`);
  lines.push(`   if(!SpreadOk(InpSymbol, InpMaxSpreadPoints)) return;`);
  lines.push(``);
  lines.push(`   double slPrice = 0.0;`);
  lines.push(`   int signal = CheckEntrySignal(slPrice);`);
  lines.push(`   if(signal == 0) return;`);
  lines.push(``);
  lines.push(`   double point = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);`);
  lines.push(`   double ask   = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);`);
  lines.push(`   double bid   = SymbolInfoDouble(InpSymbol, SYMBOL_BID);`);
  lines.push(`   int    digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);`);
  lines.push(`   long   stopsLevel = SymbolInfoInteger(InpSymbol, SYMBOL_TRADE_STOPS_LEVEL);`);
  lines.push(``);
  lines.push(`   if(signal > 0) // Buy`);
  lines.push(`   {`);
  lines.push(`      double sl   = NormalizeDouble(slPrice, digits);`);
  lines.push(`      double dist = (ask - sl) / point;`);
  lines.push(`      if(dist < stopsLevel) return;`);
  lines.push(`      double tp   = NormalizeDouble(ask + (ask - sl) * InpRewardRisk, digits);`);
  lines.push(`      double lot  = CalcLot(dist, InpSymbol, InpRiskPercent);`);
  lines.push(`      if(lot <= 0) return;`);
  lines.push(`      trade.Buy(lot, InpSymbol, ask, sl, tp, "EA Builder Buy");`);
  lines.push(`   }`);
  lines.push(`   else // Sell`);
  lines.push(`   {`);
  lines.push(`      double sl   = NormalizeDouble(slPrice, digits);`);
  lines.push(`      double dist = (sl - bid) / point;`);
  lines.push(`      if(dist < stopsLevel) return;`);
  lines.push(`      double tp   = NormalizeDouble(bid - (sl - bid) * InpRewardRisk, digits);`);
  lines.push(`      double lot  = CalcLot(dist, InpSymbol, InpRiskPercent);`);
  lines.push(`      if(lot <= 0) return;`);
  lines.push(`      trade.Sell(lot, InpSymbol, bid, sl, tp, "EA Builder Sell");`);
  lines.push(`   }`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n") + "\n";
}

function genRulesComment(bp: StrategyBlueprint): string {
  const lines = [
    `//+------------------------------------------------------------------+`,
    `//| Strategy rules extracted from blueprint                          |`,
    `//+------------------------------------------------------------------+`,
  ];
  for (const rule of bp.rules) {
    const status = rule.compilable ? "compiled" : "TODO";
    lines.push(`// [${status}] ${rule.type} (${rule.side}): ${rule.label}`);
    if (rule.subjectiveNote) lines.push(`//          Note: ${rule.subjectiveNote}`);
    if (rule.mql5Hint)       lines.push(`//          Hint: ${rule.mql5Hint}`);
  }
  if (bp.pendingClarifications.length > 0) {
    lines.push(`//`);
    lines.push(`// Pending clarifications:`);
    bp.pendingClarifications.forEach((q, i) => lines.push(`//   ${i + 1}. ${q}`));
  }
  lines.push(`//+------------------------------------------------------------------+`);
  lines.push(``);
  return lines.join("\n") + "\n";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a complete, always-compilable MQL5 EA from a StrategyBlueprint.
 * Does not call any external API — pure TypeScript → MQL5 template expansion.
 */
export function generateMql5FromBlueprint(bp: StrategyBlueprint): string {
  const ctx = analyze(bp);
  return [
    genHeader(bp),
    genInputs(bp, ctx),
    genGlobals(ctx),
    genRulesComment(bp),
    genHelpers(),
    genStrategyHelpers(bp, ctx),
    genOnInit(bp, ctx),
    genOnDeinit(ctx),
    genOnTick(bp, ctx),
  ].join("");
}
