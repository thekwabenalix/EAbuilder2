/**
 * Execution Brain Generator
 *
 * Generates Execution_Brain_Execute() — detects a precise entry trigger.
 * Sets gExecSignal = true + gExecDir (direction) + gExecSL (stop level).
 * Resets every bar — entry signals are point-in-time.
 *
 * The signal fires only when the entry pattern aligns with gBias AND gSetupDir.
 * Trade execution lives in OnTick (gen-ea.ts), not here.
 *
 * Supported modules (OR logic):
 *   fvg           — FVG retest + close-back bounce
 *   order_block   — OB zone retest + rejection candle
 *   liqsweep      — sweep of recent extreme + close back
 *   engulfing     — strong reversal candle
 *   pin_bar       — long-wick rejection
 *   bos / choch   — fresh structure break
 *   snr           — bounce off swing level
 *   ema           — cross of fast/slow MA
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

export function genExecutionBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// ─── Execution Brain: disabled ───────────────────────────────────────────────
void Execution_Brain_Execute() { gExecSignal = false; gExecDir = 0; gExecSL = 0; }
`;
  }

  const modules = brain.modules ?? [];
  const tf = brain.timeframe ?? "H1";
  const TF = tfConst(tf);

  const parts: string[] = [];

  for (const mod of modules) {
    switch (mod) {
      case "fvg_inversion": {
        // iFVG Execution:
        //   Detect the EXACT bar (shift=1) that inverts an existing FVG.
        //   "A candle closes above/below the FVG" = the inverting bar.
        //   SL = low of the inverting candle (for buy) / high (for sell).
        //   This fires once per inversion event — the entry candle IS the signal.
        parts.push(`
   // iFVG Execution: detect the bar that closes through an existing FVG (inversion event)
   if(!gExecSignal)
   {
      double _c1 = iClose(InpSymbol, ${TF}, 1);  // just-closed bar (inverting candidate)
      double _h1 = iHigh (InpSymbol, ${TF}, 1);
      double _l1 = iLow  (InpSymbol, ${TF}, 1);

      // Scan for existing bearish gaps (C.high < A.low) that _c1 has closed through upward
      for(int _i = 3; _i <= 30 && !gExecSignal; _i++)
      {
         double _gapBot = iHigh(InpSymbol, ${TF}, _i);        // C.high = gap bottom
         double _gapTop = iLow (InpSymbol, ${TF}, _i + 2);   // A.low  = gap top
         if(_gapBot >= _gapTop) continue;                     // Not a bearish gap
         if(gBias != 0 && gBias != 1) continue;
         if(gSetupDir != 0 && gSetupDir != 1) continue;

         // Inversion: bar at shift _i is the gap's C candle (formed gap)
         // bar at shift 1 closes ABOVE the gap top (_gapTop = A.low)
         // Verify shift 1 is more recent than shift _i (always true since _i >= 3)
         if(_c1 > _gapTop)
         {
            gExecSignal = true;
            gExecDir    = 1;        // BUY — bearish gap inverted bullishly
            gExecSL     = _l1;      // SL at low of the inverting candle
            PrintFormat("[EXEC/${tf}] iFVG BULL: gap top=%.5f inverted by c1=%.5f SL=%.5f",
                        _gapTop, _c1, _l1);
         }
      }

      // Scan for existing bullish gaps (C.low > A.high) that _c1 has closed through downward
      for(int _i = 3; _i <= 30 && !gExecSignal; _i++)
      {
         double _gapTop = iLow (InpSymbol, ${TF}, _i);        // C.low  = gap top
         double _gapBot = iHigh(InpSymbol, ${TF}, _i + 2);   // A.high = gap bottom
         if(_gapTop <= _gapBot) continue;                     // Not a bullish gap
         if(gBias != 0 && gBias != -1) continue;
         if(gSetupDir != 0 && gSetupDir != -1) continue;

         if(_c1 < _gapBot)
         {
            gExecSignal = true;
            gExecDir    = -1;       // SELL — bullish gap inverted bearishly
            gExecSL     = _h1;      // SL at high of the inverting candle
            PrintFormat("[EXEC/${tf}] iFVG BEAR: gap bot=%.5f inverted by c1=%.5f SL=%.5f",
                        _gapBot, _c1, _h1);
         }
      }
   }`);
        break;
      }

      case "fvg": {
        parts.push(`
   // FVG: detect 3-candle imbalance → price enters gap → close bounces out
   if(!gExecSignal)
   {
      for(int i = 1; i <= 20 && !gExecSignal; i++)
      {
         double h_i   = iHigh(InpSymbol, ${TF}, i);
         double l_i   = iLow (InpSymbol, ${TF}, i);
         double h_ip2 = iHigh(InpSymbol, ${TF}, i + 2);
         double l_ip2 = iLow (InpSymbol, ${TF}, i + 2);
         double c1    = iClose(InpSymbol, ${TF}, 1);
         double l1    = iLow  (InpSymbol, ${TF}, 1);
         double h1    = iHigh (InpSymbol, ${TF}, 1);

         // Bullish FVG: gap ul=l_i, ll=h_ip2. Price entered gap and closed above ul.
         if(l_i > h_ip2 && c1 > l_i && l1 <= l_i && (gBias==0||gBias==1) && (gSetupDir==0||gSetupDir==1))
         {
            gExecSignal = true;
            gExecDir    = 1;
            gExecSL     = l1;    // SL below retest wick
            PrintFormat("[EXEC/${tf}] FVG BULL entry gap=%.5f-%.5f SL=%.5f", l_i, h_ip2, gExecSL);
            break;
         }
         // Bearish FVG: gap ul=l_ip2, ll=h_i. Price entered gap and closed below ll.
         if(h_i < l_ip2 && c1 < h_i && h1 >= h_i && (gBias==0||gBias==-1) && (gSetupDir==0||gSetupDir==-1))
         {
            gExecSignal = true;
            gExecDir    = -1;
            gExecSL     = h1;    // SL above retest wick
            PrintFormat("[EXEC/${tf}] FVG BEAR entry gap=%.5f-%.5f SL=%.5f", l_ip2, h_i, gExecSL);
            break;
         }
      }
   }`);
        break;
      }

      case "order_block": {
        parts.push(`
   // Order Block: displacement → last opposing candle → price retests that zone
   if(!gExecSignal)
   {
      for(int i = 1; i <= 10 && !gExecSignal; i++)
      {
         double dispO = iOpen (InpSymbol, ${TF}, i);
         double dispC = iClose(InpSymbol, ${TF}, i);
         double dispH = iHigh (InpSymbol, ${TF}, i);
         double dispL = iLow  (InpSymbol, ${TF}, i);
         double body  = MathAbs(dispC - dispO);
         double range = dispH - dispL;
         if(range <= 0 || body < range * 0.6) continue;
         int dispDir = (dispC > dispO) ? 1 : -1;
         if((gBias != 0 && dispDir != gBias) || (gSetupDir != 0 && dispDir != gSetupDir)) continue;

         for(int j = i + 1; j <= i + 5 && !gExecSignal; j++)
         {
            double obO = iOpen (InpSymbol, ${TF}, j);
            double obC = iClose(InpSymbol, ${TF}, j);
            double obH = iHigh (InpSymbol, ${TF}, j);
            double obL = iLow  (InpSymbol, ${TF}, j);
            if(!((dispDir == 1 && obC < obO) || (dispDir == -1 && obC > obO))) continue;
            // Check if just-closed bar retested the OB zone and rejected
            double c1 = iClose(InpSymbol, ${TF}, 1);
            double l1 = iLow  (InpSymbol, ${TF}, 1);
            double h1 = iHigh (InpSymbol, ${TF}, 1);
            bool retested = (dispDir == 1) ? (l1 <= obH && l1 >= obL && c1 > obH)
                                           : (h1 >= obL && h1 <= obH && c1 < obL);
            if(retested)
            {
               gExecSignal = true;
               gExecDir    = dispDir;
               gExecSL     = (dispDir == 1) ? obL : obH;
               PrintFormat("[EXEC/${tf}] OB %s retest hi=%.5f lo=%.5f SL=%.5f",
                           dispDir>0?"BULL":"BEAR", obH, obL, gExecSL);
            }
         }
      }
   }`);
        break;
      }

      case "liqsweep": {
        parts.push(`
   // Liq Sweep: wick sweeps recent extreme, close back inside → entry
   if(!gExecSignal)
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
      if(h1 > swH && c1 < swH && (gBias==0||gBias==-1) && (gSetupDir==0||gSetupDir==-1))
      {
         gExecSignal = true; gExecDir = -1; gExecSL = h1;
         PrintFormat("[EXEC/${tf}] LIQ SWEEP BEAR swept=%.5f SL=%.5f", swH, h1);
      }
      else if(l1 < swL && c1 > swL && (gBias==0||gBias==1) && (gSetupDir==0||gSetupDir==1))
      {
         gExecSignal = true; gExecDir = 1; gExecSL = l1;
         PrintFormat("[EXEC/${tf}] LIQ SWEEP BULL swept=%.5f SL=%.5f", swL, l1);
      }
   }`);
        break;
      }

      case "engulfing": {
        parts.push(`
   // Engulfing: strong reversal candle — fire entry on next bar open
   if(!gExecSignal)
   {
      double o1 = iOpen (InpSymbol, ${TF}, 1);
      double c1 = iClose(InpSymbol, ${TF}, 1);
      double l1 = iLow  (InpSymbol, ${TF}, 1);
      double h1 = iHigh (InpSymbol, ${TF}, 1);
      double o2 = iOpen (InpSymbol, ${TF}, 2);
      double c2 = iClose(InpSymbol, ${TF}, 2);
      if(c1 > o1 && c2 < o2 && c1 >= o2 && o1 <= c2 && (gBias==0||gBias==1) && (gSetupDir==0||gSetupDir==1))
      {
         gExecSignal = true; gExecDir = 1; gExecSL = l1;
         PrintFormat("[EXEC/${tf}] ENGULF BULL SL=%.5f", l1);
      }
      else if(c1 < o1 && c2 > o2 && c1 <= o2 && o1 >= c2 && (gBias==0||gBias==-1) && (gSetupDir==0||gSetupDir==-1))
      {
         gExecSignal = true; gExecDir = -1; gExecSL = h1;
         PrintFormat("[EXEC/${tf}] ENGULF BEAR SL=%.5f", h1);
      }
   }`);
        break;
      }

      case "pin_bar": {
        parts.push(`
   // Pin Bar: long-wick rejection candle
   if(!gExecSignal)
   {
      double o1 = iOpen (InpSymbol, ${TF}, 1);
      double c1 = iClose(InpSymbol, ${TF}, 1);
      double h1 = iHigh (InpSymbol, ${TF}, 1);
      double l1 = iLow  (InpSymbol, ${TF}, 1);
      double range = h1 - l1;
      if(range > 0)
      {
         double body  = MathAbs(c1 - o1);
         double lwick = MathMin(o1, c1) - l1;
         double uwick = h1 - MathMax(o1, c1);
         if(lwick >= range * 0.6 && body <= range * 0.35 && (gBias==0||gBias==1) && (gSetupDir==0||gSetupDir==1))
         {
            gExecSignal = true; gExecDir = 1; gExecSL = l1;
            PrintFormat("[EXEC/${tf}] PIN BULL SL=%.5f", l1);
         }
         else if(uwick >= range * 0.6 && body <= range * 0.35 && (gBias==0||gBias==-1) && (gSetupDir==0||gSetupDir==-1))
         {
            gExecSignal = true; gExecDir = -1; gExecSL = h1;
            PrintFormat("[EXEC/${tf}] PIN BEAR SL=%.5f", h1);
         }
      }
   }`);
        break;
      }

      case "bos":
      case "choch": {
        const label = mod === "bos" ? "BOS" : "CHoCH";
        parts.push(`
   // ${label}: fresh structure break — fire entry on same bar
   if(!gExecSignal)
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
      double l1 = iLow  (InpSymbol, ${TF}, 1);
      double h1 = iHigh (InpSymbol, ${TF}, 1);
      if(c1 > swH && (gBias==0||gBias==1) && (gSetupDir==0||gSetupDir==1))
      {
         gExecSignal = true; gExecDir = 1; gExecSL = swL;
         PrintFormat("[EXEC/${tf}] ${label} BULL break=%.5f SL=%.5f", swH, swL);
      }
      else if(c1 < swL && (gBias==0||gBias==-1) && (gSetupDir==0||gSetupDir==-1))
      {
         gExecSignal = true; gExecDir = -1; gExecSL = swH;
         PrintFormat("[EXEC/${tf}] ${label} BEAR break=%.5f SL=%.5f", swL, swH);
      }
   }`);
        break;
      }

      case "snr": {
        parts.push(`
   // S/R: price bouncing off swing level
   if(!gExecSignal)
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
      double pt  = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
      double c1  = iClose(InpSymbol, ${TF}, 1);
      double l1  = iLow  (InpSymbol, ${TF}, 1);
      double h1  = iHigh (InpSymbol, ${TF}, 1);
      double o1  = iOpen (InpSymbol, ${TF}, 1);
      // Bullish: touched support and closed above it
      if(l1 <= swL + 20 * pt && c1 > swL && c1 > o1 && (gBias==0||gBias==1) && (gSetupDir==0||gSetupDir==1))
      {
         gExecSignal = true; gExecDir = 1; gExecSL = swL;
         PrintFormat("[EXEC/${tf}] S/R BULL bounce support=%.5f SL=%.5f", swL, swL);
      }
      // Bearish: touched resistance and closed below it
      else if(h1 >= swH - 20 * pt && c1 < swH && c1 < o1 && (gBias==0||gBias==-1) && (gSetupDir==0||gSetupDir==-1))
      {
         gExecSignal = true; gExecDir = -1; gExecSL = swH;
         PrintFormat("[EXEC/${tf}] S/R BEAR rejection resistance=%.5f SL=%.5f", swH, swH);
      }
   }`);
        break;
      }

      case "ema": {
        parts.push(`
   // EMA: fast/slow cross fires entry signal
   if(!gExecSignal)
   {
      double fast1 = 0.0, fast2 = 0.0, slow1 = 0.0, slow2 = 0.0;
      for(int i = 1; i <= 50; i++) {
         double c = iClose(InpSymbol, ${TF}, i);
         double cp = iClose(InpSymbol, ${TF}, i + 1);
         if(i <= 21) { fast1 += c; fast2 += cp; }
         slow1 += c; slow2 += cp;
      }
      fast1 /= 21.0; fast2 /= 21.0;
      slow1 /= 50.0; slow2 /= 50.0;
      double l1 = iLow (InpSymbol, ${TF}, 1);
      double h1 = iHigh(InpSymbol, ${TF}, 1);
      // Golden cross: fast crossed above slow this bar
      if(fast2 <= slow2 && fast1 > slow1 && (gBias==0||gBias==1) && (gSetupDir==0||gSetupDir==1))
      {
         gExecSignal = true; gExecDir = 1; gExecSL = l1;
         PrintFormat("[EXEC/${tf}] EMA GOLDEN CROSS fast=%.5f slow=%.5f SL=%.5f", fast1, slow1, l1);
      }
      // Death cross: fast crossed below slow this bar
      else if(fast2 >= slow2 && fast1 < slow1 && (gBias==0||gBias==-1) && (gSetupDir==0||gSetupDir==-1))
      {
         gExecSignal = true; gExecDir = -1; gExecSL = h1;
         PrintFormat("[EXEC/${tf}] EMA DEATH CROSS fast=%.5f slow=%.5f SL=%.5f", fast1, slow1, h1);
      }
   }`);
        break;
      }

      default:
        parts.push(`
   // Module '${mod}' on ${tf}: not yet implemented for Execution Brain`);
    }
  }

  const detectionBody = parts.join("\n");

  return `
// ─── Execution Brain: ${modules.join(" + ").toUpperCase()} @ ${tf} ─────────────────────────────
void Execution_Brain_Execute()
{
   gExecSignal = false;   // Reset each bar — entry signals are point-in-time
   gExecDir    = 0;
   gExecSL     = 0.0;
${detectionBody}
}
`;
}
