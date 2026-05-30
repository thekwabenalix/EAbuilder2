/**
 * Setup Brain Generator
 *
 * Generates Setup_Brain_Execute() — detects zones/setups that agree with gBias.
 * Sets gSetupActive = true when a valid zone is found in the bias direction.
 * Also sets gSetupSLHint = far edge of zone for SL calculation.
 *
 * Reset strategy: gSetupActive is reset each bar then re-detected (simple & reliable).
 * Once a zone is confirmed, gSetupActive stays true until a trade fires or price
 * invalidates the zone.
 *
 * Supported modules (OR logic — any detected zone activates setup):
 *   order_block   — ATR-displacement OB with price retesting zone
 *   fvg           — 3-candle imbalance zone retested
 *   liqsweep      — liquidity sweep + close-back
 *   bos / choch   — structure break in bias direction
 *   snr           — price at swing high/low zone
 *   engulfing     — strong candle in bias direction
 *   pin_bar       — wick rejection in bias direction
 *   ema           — price above/below EMA alignment
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

export function genSetupBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// ─── Setup Brain: disabled ───────────────────────────────────────────────────
// gSetupActive is passthrough — always true when bias is set.
void Setup_Brain_Execute()
{
   gSetupActive = (gBias != 0);
   gSetupDir    = gBias;
}
`;
  }

  const modules = brain.modules ?? [];
  const tf = brain.timeframe ?? "H4";
  const TF = tfConst(tf);

  const parts: string[] = [];

  for (const mod of modules) {
    switch (mod) {
      case "order_block": {
        parts.push(`
   // Order Block: detect OB zone — last opposing candle before a strong displacement
   if(!gSetupActive)
   {
      // Check last 10 bars for a displacement candle (body >= 60% of range)
      for(int i = 1; i <= 10 && !gSetupActive; i++)
      {
         double dispO = iOpen (InpSymbol, ${TF}, i);
         double dispC = iClose(InpSymbol, ${TF}, i);
         double dispH = iHigh (InpSymbol, ${TF}, i);
         double dispL = iLow  (InpSymbol, ${TF}, i);
         double dispBody  = MathAbs(dispC - dispO);
         double dispRange = dispH - dispL;
         if(dispRange <= 0 || dispBody < dispRange * 0.6) continue;

         int dispDir = (dispC > dispO) ? 1 : -1;
         if(gBias != 0 && dispDir != gBias) continue;  // wrong direction

         // Find last opposing candle before displacement (up to 5 bars back)
         for(int j = i + 1; j <= i + 5; j++)
         {
            double obO = iOpen (InpSymbol, ${TF}, j);
            double obC = iClose(InpSymbol, ${TF}, j);
            double obH = iHigh (InpSymbol, ${TF}, j);
            double obL = iLow  (InpSymbol, ${TF}, j);
            if((dispDir ==  1 && obC < obO) ||   // Bullish disp → last bear candle
               (dispDir == -1 && obC > obO))      // Bearish disp → last bull candle
            {
               // OB zone found. Check if current price is retesting it.
               double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
               double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
               bool retesting = (dispDir ==  1 && ask >= obL && ask <= obH) ||
                                (dispDir == -1 && bid >= obL && bid <= obH);
               gSetupActive  = true;
               gSetupDir     = dispDir;
               gSetupSLHint  = (dispDir == 1) ? obL : obH;
               PrintFormat("[SETUP/${tf}] OB %s zone hi=%.5f lo=%.5f retesting=%d",
                           dispDir>0?"BULL":"BEAR", obH, obL, retesting);
               break;
            }
         }
      }
   }`);
        break;
      }

      case "fvg_inversion": {
        // iFVG Setup: look for a recently inverted FVG in the bias direction.
        // Bullish iFVG = bearish gap that price closed back above → setup for longs.
        // Bearish iFVG = bullish gap that price closed back below → setup for shorts.
        parts.push(`
   // iFVG Setup: scan for a recently inverted FVG aligned with gBias
   if(!gSetupActive)
   {
      for(int _i = 3; _i <= 30 && !gSetupActive; _i++)
      {
         double _cHigh = iHigh(InpSymbol, ${TF}, _i);
         double _aLow  = iLow (InpSymbol, ${TF}, _i + 2);
         double _cLow  = iLow (InpSymbol, ${TF}, _i);
         double _aHigh = iHigh(InpSymbol, ${TF}, _i + 2);

         // Bearish gap → bullish iFVG when price closes above _aLow
         if(_cHigh < _aLow && (gBias == 0 || gBias == 1))
         {
            for(int _j = 1; _j < _i && !gSetupActive; _j++)
            {
               if(iClose(InpSymbol, ${TF}, _j) > _aLow)
               {
                  gSetupActive = true;
                  gSetupDir    = 1;
                  gSetupSLHint = _cHigh;  // Bottom of the bearish gap
                  PrintFormat("[SETUP/${tf}] iFVG BULL inverted gap top=%.5f bot=%.5f",
                              _aLow, _cHigh);
               }
            }
         }
         // Bullish gap → bearish iFVG when price closes below _aHigh
         else if(_cLow > _aHigh && (gBias == 0 || gBias == -1))
         {
            for(int _j = 1; _j < _i && !gSetupActive; _j++)
            {
               if(iClose(InpSymbol, ${TF}, _j) < _aHigh)
               {
                  gSetupActive = true;
                  gSetupDir    = -1;
                  gSetupSLHint = _cLow;   // Top of the bullish gap
                  PrintFormat("[SETUP/${tf}] iFVG BEAR inverted gap top=%.5f bot=%.5f",
                              _cLow, _aHigh);
               }
            }
         }
      }
   }`);
        break;
      }

      case "fvg": {
        parts.push(`
   // FVG: detect 3-candle imbalance zone that price is retesting
   if(!gSetupActive)
   {
      for(int i = 1; i <= 20 && !gSetupActive; i++)
      {
         double h_i   = iHigh(InpSymbol, ${TF}, i);
         double l_i   = iLow (InpSymbol, ${TF}, i);
         double h_ip2 = iHigh(InpSymbol, ${TF}, i + 2);
         double l_ip2 = iLow (InpSymbol, ${TF}, i + 2);

         // Bullish FVG: candle[i].low > candle[i+2].high
         if(l_i > h_ip2 && (gBias == 0 || gBias == 1))
         {
            double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
            if(ask <= l_i && ask >= h_ip2)  // price retesting the gap
            {
               gSetupActive = true;
               gSetupDir    = 1;
               gSetupSLHint = h_ip2;
               PrintFormat("[SETUP/${tf}] FVG BULL gap ul=%.5f ll=%.5f", l_i, h_ip2);
            }
         }
         // Bearish FVG: candle[i].high < candle[i+2].low
         else if(h_i < l_ip2 && (gBias == 0 || gBias == -1))
         {
            double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
            if(bid >= h_i && bid <= l_ip2)  // price retesting the gap
            {
               gSetupActive = true;
               gSetupDir    = -1;
               gSetupSLHint = l_ip2;
               PrintFormat("[SETUP/${tf}] FVG BEAR gap ul=%.5f ll=%.5f", l_ip2, h_i);
            }
         }
      }
   }`);
        break;
      }

      case "liqsweep": {
        parts.push(`
   // Liq Sweep: price swept a recent extreme and closed back — active setup
   if(!gSetupActive)
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
      if(h1 > swH && c1 < swH && (gBias == 0 || gBias == -1))
      {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = h1;
         PrintFormat("[SETUP/${tf}] LIQ SWEEP bearish high=%.5f", swH);
      }
      else if(l1 < swL && c1 > swL && (gBias == 0 || gBias == 1))
      {
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = l1;
         PrintFormat("[SETUP/${tf}] LIQ SWEEP bullish low=%.5f", swL);
      }
   }`);
        break;
      }

      case "bos":
      case "choch": {
        const label = mod === "bos" ? "BOS" : "CHoCH";
        parts.push(`
   // ${label}: fresh break in bias direction creates setup
   if(!gSetupActive)
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
      if(c1 > swH && (gBias == 0 || gBias == 1))
      {
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = swL;
         PrintFormat("[SETUP/${tf}] ${label} BULL break level=%.5f", swH);
      }
      else if(c1 < swL && (gBias == 0 || gBias == -1))
      {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = swH;
         PrintFormat("[SETUP/${tf}] ${label} BEAR break level=%.5f", swL);
      }
   }`);
        break;
      }

      case "snr": {
        parts.push(`
   // S/R: price touching a swing zone creates setup
   if(!gSetupActive)
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
      double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
      double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      // Bullish: price near swing low (within 30 points)
      if(MathAbs(bid - swL) <= 30 * pt && (gBias == 0 || gBias == 1))
      {
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = swL;
         PrintFormat("[SETUP/${tf}] S/R near BULL support=%.5f", swL);
      }
      // Bearish: price near swing high (within 30 points)
      else if(MathAbs(ask - swH) <= 30 * pt && (gBias == 0 || gBias == -1))
      {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = swH;
         PrintFormat("[SETUP/${tf}] S/R near BEAR resistance=%.5f", swH);
      }
   }`);
        break;
      }

      case "engulfing": {
        parts.push(`
   // Engulfing: strong candle in bias direction creates setup
   if(!gSetupActive)
   {
      double o1 = iOpen (InpSymbol, ${TF}, 1);
      double c1 = iClose(InpSymbol, ${TF}, 1);
      double l1 = iLow  (InpSymbol, ${TF}, 1);
      double h1 = iHigh (InpSymbol, ${TF}, 1);
      double o2 = iOpen (InpSymbol, ${TF}, 2);
      double c2 = iClose(InpSymbol, ${TF}, 2);
      if(c1 > o1 && c2 < o2 && c1 >= o2 && o1 <= c2 && (gBias == 0 || gBias == 1))
      {
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = l1;
         PrintFormat("[SETUP/${tf}] ENGULF BULL setup SL hint=%.5f", l1);
      }
      else if(c1 < o1 && c2 > o2 && c1 <= o2 && o1 >= c2 && (gBias == 0 || gBias == -1))
      {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = h1;
         PrintFormat("[SETUP/${tf}] ENGULF BEAR setup SL hint=%.5f", h1);
      }
   }`);
        break;
      }

      case "pin_bar": {
        parts.push(`
   // Pin Bar: wick rejection in bias direction creates setup
   if(!gSetupActive)
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
         if(lwick >= range * 0.6 && body <= range * 0.35 && (gBias == 0 || gBias == 1))
         {
            gSetupActive = true; gSetupDir = 1; gSetupSLHint = l1;
            PrintFormat("[SETUP/${tf}] PIN BULL setup SL hint=%.5f", l1);
         }
         else if(uwick >= range * 0.6 && body <= range * 0.35 && (gBias == 0 || gBias == -1))
         {
            gSetupActive = true; gSetupDir = -1; gSetupSLHint = h1;
            PrintFormat("[SETUP/${tf}] PIN BEAR setup SL hint=%.5f", h1);
         }
      }
   }`);
        break;
      }

      case "ema": {
        parts.push(`
   // EMA alignment: fast > slow in bias direction creates setup
   if(!gSetupActive)
   {
      double fastSum = 0.0, slowSum = 0.0;
      for(int i = 1; i <= 50; i++) {
         double c = iClose(InpSymbol, ${TF}, i);
         if(i <= 21) fastSum += c;
         slowSum += c;
      }
      double fastMA = fastSum / 21.0;
      double slowMA = slowSum / 50.0;
      if(fastMA > slowMA && (gBias == 0 || gBias == 1))
      {
         double c1 = iClose(InpSymbol, ${TF}, 1);
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = fastMA;
         PrintFormat("[SETUP/${tf}] EMA BULL fast=%.5f slow=%.5f", fastMA, slowMA);
      }
      else if(fastMA < slowMA && (gBias == 0 || gBias == -1))
      {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = fastMA;
         PrintFormat("[SETUP/${tf}] EMA BEAR fast=%.5f slow=%.5f", fastMA, slowMA);
      }
   }`);
        break;
      }

      default:
        parts.push(`
   // Module '${mod}' on ${tf}: not yet implemented for Setup Brain`);
    }
  }

  const detectionBody = parts.join("\n");

  return `
// ─── Setup Brain: ${modules.join(" + ").toUpperCase()} @ ${tf} ──────────────────────────────────
void Setup_Brain_Execute()
{
   gSetupActive = false;   // Reset — re-detect every bar
   gSetupDir    = 0;
${detectionBody}
}
`;
}
