/**
 * Direction Brain Generator
 *
 * Generates Direction_Brain_Execute() — updates gBias PERSISTENTLY.
 * gBias = 1 (BULL) or -1 (BEAR). Never resets to 0 mid-session
 * — once bias is established it stays until the opposite break fires.
 *
 * Supported modules (OR logic — any detected break flips the bias):
 *   bos / choch   — close beyond 20-bar swing high/low
 *   fvg           — 3-candle imbalance (gap) sets bias toward gap direction
 *   order_block   — displacement candle beyond swing → bias in displacement dir
 *   liqsweep      — sweep + close-back → bias toward the bounce
 *   ema           — fast EMA / slow EMA alignment
 *   engulfing     — strong reversal candle sets bias
 *   pin_bar       — long-wick rejection sets bias
 *   snr           — price above/below recent swing → bias
 */

import type { BrainConfig } from "@/types/blueprint";

function tfConst(tf: string): string {
  const map: Record<string, string> = {
    M1: "PERIOD_M1",  M5: "PERIOD_M5",  M15: "PERIOD_M15", M30: "PERIOD_M30",
    H1: "PERIOD_H1",  H4: "PERIOD_H4",  D1: "PERIOD_D1",   W1: "PERIOD_W1",
    MN: "PERIOD_MN1",
  };
  return map[tf.toUpperCase()] ?? "PERIOD_H1";
}

export function genDirectionBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// ─── Direction Brain: disabled ───────────────────────────────────────────────
// gBias stays 0 (NEUTRAL) — both directions are traded.
void Direction_Brain_Execute() {}
`;
  }

  const modules = brain.modules ?? [];
  const tf = brain.timeframe ?? "D1";
  const TF = tfConst(tf);

  // Build per-module detection snippets (OR logic — any sets the bias)
  const parts: string[] = [];

  for (const mod of modules) {
    switch (mod) {
      case "bos_choch": {
        // Combined BOS + CHoCH: detect either break type and set bias
        parts.push(`
   // BOS + CHoCH combined: close beyond 20-bar swing sets bias
   {
      double swH = iHigh(InpSymbol, ${TF}, 2);
      double swL = iLow (InpSymbol, ${TF}, 2);
      for(int i = 3; i <= 20; i++)
      {
         double h = iHigh(InpSymbol, ${TF}, i);
         double l = iLow (InpSymbol, ${TF}, i);
         if(h > swH) swH = h;
         if(l < swL) swL = l;
      }
      double c1 = iClose(InpSymbol, ${TF}, 1);
      if(c1 > swH)
      {
         if(gBias != 1) PrintFormat("[DIR/${tf}] BOS+CHoCH BULL break @ %.5f", swH);
         gBias = 1;
      }
      else if(c1 < swL)
      {
         if(gBias != -1) PrintFormat("[DIR/${tf}] BOS+CHoCH BEAR break @ %.5f", swL);
         gBias = -1;
      }
   }`);
        break;
      }

      case "swing_structure": {
        // Swing structure: uses highs/lows over 50 bars
        parts.push(`
   // Swing Structure: close beyond 50-bar swing extreme sets bias
   {
      double swH = iHigh(InpSymbol, ${TF}, 1);
      double swL = iLow (InpSymbol, ${TF}, 1);
      for(int i = 2; i <= 50; i++)
      {
         double h = iHigh(InpSymbol, ${TF}, i);
         double l = iLow (InpSymbol, ${TF}, i);
         if(h > swH) swH = h;
         if(l < swL) swL = l;
      }
      double c0 = iClose(InpSymbol, ${TF}, 0);  // current bar
      if(c0 > swH)
      {
         if(gBias != 1) PrintFormat("[DIR/${tf}] SWING STRUCT BULL above=%.5f", swH);
         gBias = 1;
      }
      else if(c0 < swL)
      {
         if(gBias != -1) PrintFormat("[DIR/${tf}] SWING STRUCT BEAR below=%.5f", swL);
         gBias = -1;
      }
   }`);
        break;
      }

      case "fvg_inversion": {
        // FVG Inversion: gap that price trades through (inversion signal)
        parts.push(`
   // FVG Inversion: gap created then price returns through it
   {
      double h1 = iHigh(InpSymbol, ${TF}, 1);
      double l1 = iLow (InpSymbol, ${TF}, 1);
      double h3 = iHigh(InpSymbol, ${TF}, 3);
      double l3 = iLow (InpSymbol, ${TF}, 3);
      double c0 = iClose(InpSymbol, ${TF}, 0);
      // Bullish inversion: prior bullish gap, price trades back through it bullishly
      if(l1 > h3 && c0 > l1)  // price above prior gap top
      {
         if(gBias != 1) PrintFormat("[DIR/${tf}] IFVG BULL inversion ul=%.5f", l1);
         gBias = 1;
      }
      // Bearish inversion: prior bearish gap, price trades back through it bearishly
      else if(h1 < l3 && c0 < h1)
      {
         if(gBias != -1) PrintFormat("[DIR/${tf}] IFVG BEAR inversion ll=%.5f", h1);
         gBias = -1;
      }
   }`);
        break;
      }

      case "breakout": {
        // Breakout: close beyond 20-bar range with momentum
        parts.push(`
   // Breakout: close beyond 20-bar range
   {
      double rangeH = iHigh(InpSymbol, ${TF}, 1);
      double rangeL = iLow (InpSymbol, ${TF}, 1);
      for(int i = 2; i <= 20; i++)
      {
         double h = iHigh(InpSymbol, ${TF}, i);
         double l = iLow (InpSymbol, ${TF}, i);
         if(h > rangeH) rangeH = h;
         if(l < rangeL) rangeL = l;
      }
      double c1 = iClose(InpSymbol, ${TF}, 1);
      if(c1 > rangeH)
      {
         if(gBias != 1) PrintFormat("[DIR/${tf}] BREAKOUT BULL above=%.5f", rangeH);
         gBias = 1;
      }
      else if(c1 < rangeL)
      {
         if(gBias != -1) PrintFormat("[DIR/${tf}] BREAKOUT BEAR below=%.5f", rangeL);
         gBias = -1;
      }
   }`);
        break;
      }

      case "bb": {
        // Bollinger Bands: price above/below midline → bias
        parts.push(`
   // Bollinger Bands: price position vs midline (20 SMA)
   {
      double sum = 0.0;
      for(int i = 1; i <= 20; i++) sum += iClose(InpSymbol, ${TF}, i);
      double mid = sum / 20.0;
      double c1 = iClose(InpSymbol, ${TF}, 1);
      int newBias = (c1 > mid) ? 1 : -1;
      if(gBias != newBias)
         PrintFormat("[DIR/${tf}] BB %s price=%.5f mid=%.5f", newBias>0?"BULL":"BEAR", c1, mid);
      gBias = newBias;
   }`);
        break;
      }

      case "gap_snr": {
        // Gap S/R: treat recent gap edges as support/resistance
        parts.push(`
   // Gap S/R: price near recent gap edge sets bias
   {
      double h1 = iHigh(InpSymbol, ${TF}, 1);
      double l1 = iLow (InpSymbol, ${TF}, 1);
      double h3 = iHigh(InpSymbol, ${TF}, 3);
      double l3 = iLow (InpSymbol, ${TF}, 3);
      double c0 = iClose(InpSymbol, ${TF}, 0);
      double pt  = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
      // Bullish gap: c0 above gap lower limit
      if(l1 > h3 && c0 > h3)
      {
         if(gBias != 1) PrintFormat("[DIR/${tf}] GAP S/R BULL above=%.5f", h3);
         gBias = 1;
      }
      // Bearish gap: c0 below gap upper limit
      else if(h1 < l3 && c0 < l3)
      {
         if(gBias != -1) PrintFormat("[DIR/${tf}] GAP S/R BEAR below=%.5f", l3);
         gBias = -1;
      }
   }`);
        break;
      }

      case "bos":
      case "choch": {
        const label = mod === "bos" ? "BOS" : "CHoCH";
        parts.push(`
   // ${label}: close beyond 20-bar swing high/low
   {
      double swH = iHigh(InpSymbol, ${TF}, 2);
      double swL = iLow (InpSymbol, ${TF}, 2);
      for(int i = 3; i <= 20; i++)
      {
         double h = iHigh(InpSymbol, ${TF}, i);
         double l = iLow (InpSymbol, ${TF}, i);
         if(h > swH) swH = h;
         if(l < swL) swL = l;
      }
      double c1 = iClose(InpSymbol, ${TF}, 1);
      if(c1 > swH)
      {
         if(gBias != 1) PrintFormat("[DIR/${tf}] ${label} BULL break @ %.5f", swH);
         gBias = 1;
      }
      else if(c1 < swL)
      {
         if(gBias != -1) PrintFormat("[DIR/${tf}] ${label} BEAR break @ %.5f", swL);
         gBias = -1;
      }
   }`);
        break;
      }

      case "fvg": {
        parts.push(`
   // FVG: 3-candle imbalance sets bias toward gap direction
   {
      double h1 = iHigh(InpSymbol, ${TF}, 1);
      double l1 = iLow (InpSymbol, ${TF}, 1);
      double h3 = iHigh(InpSymbol, ${TF}, 3);
      double l3 = iLow (InpSymbol, ${TF}, 3);
      if(l1 > h3)                          // Bullish FVG (gap up)
      {
         if(gBias != 1) PrintFormat("[DIR/${tf}] FVG BULL gap ul=%.5f ll=%.5f", l1, h3);
         gBias = 1;
      }
      else if(h1 < l3)                     // Bearish FVG (gap down)
      {
         if(gBias != -1) PrintFormat("[DIR/${tf}] FVG BEAR gap ul=%.5f ll=%.5f", l3, h1);
         gBias = -1;
      }
   }`);
        break;
      }

      case "order_block": {
        parts.push(`
   // Order Block: strong displacement candle sets bias
   {
      double o1 = iOpen (InpSymbol, ${TF}, 1);
      double c1 = iClose(InpSymbol, ${TF}, 1);
      double h1 = iHigh (InpSymbol, ${TF}, 1);
      double l1 = iLow  (InpSymbol, ${TF}, 1);
      double body = MathAbs(c1 - o1);
      double range = h1 - l1;
      if(range > 0 && body >= range * 0.6)  // Strong body (>= 60% of range)
      {
         int newBias = (c1 > o1) ? 1 : -1;
         if(gBias != newBias)
            PrintFormat("[DIR/${tf}] OB displacement %s body=%.5f", c1>o1?"BULL":"BEAR", body);
         gBias = newBias;
      }
   }`);
        break;
      }

      case "liqsweep": {
        parts.push(`
   // Liq Sweep: wick sweeps recent extreme then closes back → bias toward bounce
   {
      double swH = iHigh(InpSymbol, ${TF}, 2);
      double swL = iLow (InpSymbol, ${TF}, 2);
      for(int i = 3; i <= 15; i++)
      {
         double h = iHigh(InpSymbol, ${TF}, i);
         double l = iLow (InpSymbol, ${TF}, i);
         if(h > swH) swH = h;
         if(l < swL) swL = l;
      }
      double h1 = iHigh (InpSymbol, ${TF}, 1);
      double l1 = iLow  (InpSymbol, ${TF}, 1);
      double c1 = iClose(InpSymbol, ${TF}, 1);
      if(h1 > swH && c1 < swH)        // Bear sweep: wick breaks high, close back under
      {
         if(gBias != -1) PrintFormat("[DIR/${tf}] LIQ SWEEP bearish @ %.5f", swH);
         gBias = -1;
      }
      else if(l1 < swL && c1 > swL)   // Bull sweep: wick breaks low, close back above
      {
         if(gBias != 1) PrintFormat("[DIR/${tf}] LIQ SWEEP bullish @ %.5f", swL);
         gBias = 1;
      }
   }`);
        break;
      }

      case "ema": {
        parts.push(`
   // EMA: fast (21) vs slow (50) alignment sets bias
   {
      // NOTE: For EMA we compute a rough approximation inline
      // using the last 50 closes rather than an indicator handle.
      double fastSum = 0.0, slowSum = 0.0;
      int fastPer = 21, slowPer = 50;
      // Simple moving average (close approximation of EMA for direction)
      for(int i = 1; i <= slowPer; i++)
      {
         double c = iClose(InpSymbol, ${TF}, i);
         if(i <= fastPer) fastSum += c;
         slowSum += c;
      }
      double fastMA = fastSum / fastPer;
      double slowMA = slowSum / slowPer;
      int newBias = (fastMA > slowMA) ? 1 : -1;
      if(gBias != newBias)
         PrintFormat("[DIR/${tf}] EMA %s fast=%.5f slow=%.5f", newBias>0?"BULL":"BEAR", fastMA, slowMA);
      gBias = newBias;
   }`);
        break;
      }

      case "engulfing": {
        parts.push(`
   // Engulfing: strong reversal candle sets bias
   {
      double o1 = iOpen (InpSymbol, ${TF}, 1);
      double c1 = iClose(InpSymbol, ${TF}, 1);
      double o2 = iOpen (InpSymbol, ${TF}, 2);
      double c2 = iClose(InpSymbol, ${TF}, 2);
      if(c1 > o1 && c2 < o2 && c1 >= o2 && o1 <= c2)  // Bullish engulfing
      {
         if(gBias != 1) PrintFormat("[DIR/${tf}] ENGULF BULL close=%.5f", c1);
         gBias = 1;
      }
      else if(c1 < o1 && c2 > o2 && c1 <= o2 && o1 >= c2)  // Bearish engulfing
      {
         if(gBias != -1) PrintFormat("[DIR/${tf}] ENGULF BEAR close=%.5f", c1);
         gBias = -1;
      }
   }`);
        break;
      }

      case "pin_bar": {
        parts.push(`
   // Pin Bar: long-wick rejection candle sets bias
   {
      double o1 = iOpen (InpSymbol, ${TF}, 1);
      double c1 = iClose(InpSymbol, ${TF}, 1);
      double h1 = iHigh (InpSymbol, ${TF}, 1);
      double l1 = iLow  (InpSymbol, ${TF}, 1);
      double range = h1 - l1;
      if(range > 0)
      {
         double body   = MathAbs(c1 - o1);
         double lwick  = MathMin(o1, c1) - l1;  // lower wick
         double uwick  = h1 - MathMax(o1, c1);  // upper wick
         if(lwick >= range * 0.6 && body <= range * 0.35)  // Bullish pin
         {
            if(gBias != 1) PrintFormat("[DIR/${tf}] PIN BULL wick=%.5f", lwick);
            gBias = 1;
         }
         else if(uwick >= range * 0.6 && body <= range * 0.35)  // Bearish pin
         {
            if(gBias != -1) PrintFormat("[DIR/${tf}] PIN BEAR wick=%.5f", uwick);
            gBias = -1;
         }
      }
   }`);
        break;
      }

      case "snr": {
        parts.push(`
   // S/R: price relative to 20-bar midpoint sets bias
   {
      double highest = iHigh(InpSymbol, ${TF}, 1);
      double lowest  = iLow (InpSymbol, ${TF}, 1);
      for(int i = 2; i <= 20; i++)
      {
         double h = iHigh(InpSymbol, ${TF}, i);
         double l = iLow (InpSymbol, ${TF}, i);
         if(h > highest) highest = h;
         if(l < lowest)  lowest  = l;
      }
      double mid = (highest + lowest) / 2.0;
      double c1  = iClose(InpSymbol, ${TF}, 1);
      int newBias = (c1 > mid) ? 1 : -1;
      if(gBias != newBias)
         PrintFormat("[DIR/${tf}] S/R %s price=%.5f mid=%.5f", newBias>0?"BULL":"BEAR", c1, mid);
      gBias = newBias;
   }`);
        break;
      }

      default:
        parts.push(`
   // Module '${mod}' detection on ${tf}: not yet implemented for Direction Brain`);
    }
  }

  const detectionBody = parts.join("\n");

  return `
// ─── Direction Brain: ${modules.join(" + ").toUpperCase()} @ ${tf} ─────────────────────────────
// gBias is PERSISTENT: 1=BULL, -1=BEAR. Only flips when opposite break detected.
void Direction_Brain_Execute()
{
${detectionBody}
}
`;
}
