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

/** Read a numeric param from brain.params, falling back to the default. */
function p(params: Record<string, unknown> | undefined, key: string, def: number): number {
  const v = params?.[key];
  return typeof v === "number" && isFinite(v) ? v : def;
}

function tfConst(tf: string): string {
  const map: Record<string, string> = {
    M1: "PERIOD_M1",
    M5: "PERIOD_M5",
    M15: "PERIOD_M15",
    M30: "PERIOD_M30",
    H1: "PERIOD_H1",
    H4: "PERIOD_H4",
    D1: "PERIOD_D1",
    W1: "PERIOD_W1",
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
  const brainParams = brain.params as Record<string, unknown> | undefined;

  const parts: string[] = [];

  for (const mod of modules) {
    switch (mod) {
      case "order_block": {
        const obScanBack = p(brainParams, "scanBack", 5);
        const obDispMult = p(brainParams, "dispMult", 0.6);
        parts.push(`
   // Order Block: detect OB zone — last opposing candle before a strong displacement
   if(!gSetupActive)
   {
      // Check last 10 bars for a displacement candle (body >= ${obDispMult.toFixed(1)}x range)
      for(int i = 1; i <= 10 && !gSetupActive; i++)
      {
         double dispO = iOpen (InpSymbol, ${TF}, i);
         double dispC = iClose(InpSymbol, ${TF}, i);
         double dispH = iHigh (InpSymbol, ${TF}, i);
         double dispL = iLow  (InpSymbol, ${TF}, i);
         double dispBody  = MathAbs(dispC - dispO);
         double dispRange = dispH - dispL;
         if(dispRange <= 0 || dispBody < dispRange * ${obDispMult.toFixed(1)}) continue;

         int dispDir = (dispC > dispO) ? 1 : -1;
         if(gBias != 0 && dispDir != gBias) continue;  // wrong direction

         // Find last opposing candle before displacement (up to ${obScanBack} bars back)
         for(int j = i + 1; j <= i + ${obScanBack}; j++)
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
        // Reads from the inline Phase 3 state machine (IFVGSM_${tf}_*).
        // Setup is ACTIVE when ANY live iFVG exists in the bias direction
        // (ACTIVE, RETESTED, or CONFIRMED — any non-terminal state).
        // SLHint = zone boundary of the most recent live iFVG.
        parts.push(`
   // iFVG Setup: use Phase 3 state machine — active when live iFVG in bias direction
   if(!gSetupActive)
   {
      if((gBias == 0 || gBias == 1) && IFVGSM_${tf}_HasActiveBull())
      {
         gSetupActive = true;
         gSetupDir    = 1;
         gSetupSLHint = IFVGSM_${tf}_LatestBullLL();
         double _ul = IFVGSM_${tf}_LatestBullUL();
         double _ll = IFVGSM_${tf}_LatestBullLL();
         PrintFormat("[SETUP/${tf}] iFVG BULL active | ul=%.5f ll=%.5f", _ul, _ll);
         // Draw zone
         datetime _ft = IFVGSM_${tf}_LatestBullFvgTime();
         if(_ft > 0)
         {
            for(int _ci=ObjectsTotal(0)-1;_ci>=0;_ci--){string _cn=ObjectName(0,_ci);if(StringFind(_cn,"4B_SETUP_")==0)ObjectDelete(0,_cn);}
            string _rn = StringFormat("4B_SETUP_%d",(int)TimeCurrent());
            datetime _rt2=(datetime)(iTime(InpSymbol,PERIOD_CURRENT,0)+PeriodSeconds(PERIOD_CURRENT)*30);
            if(ObjectCreate(0,_rn,OBJ_RECTANGLE,0,_ft,_ul,_rt2,_ll)){
               ObjectSetInteger(0,_rn,OBJPROP_COLOR,clrMediumSeaGreen);
               ObjectSetInteger(0,_rn,OBJPROP_STYLE,STYLE_SOLID);
               ObjectSetInteger(0,_rn,OBJPROP_WIDTH,1);
               ObjectSetInteger(0,_rn,OBJPROP_BACK,true);
               ObjectSetInteger(0,_rn,OBJPROP_FILL,false);
               ObjectSetInteger(0,_rn,OBJPROP_SELECTABLE,false);
            }
            string _ln=StringFormat("4B_SETUP_LBL_%d",(int)TimeCurrent());
            if(ObjectCreate(0,_ln,OBJ_TEXT,0,iTime(InpSymbol,PERIOD_CURRENT,0),_ll)){
               ObjectSetString(0,_ln,OBJPROP_TEXT,StringFormat("${tf} SETUP: iFVG BULL [%.5f-%.5f]",_ll,_ul));
               ObjectSetInteger(0,_ln,OBJPROP_COLOR,clrMediumSeaGreen);
               ObjectSetInteger(0,_ln,OBJPROP_FONTSIZE,8);
               ObjectSetInteger(0,_ln,OBJPROP_ANCHOR,ANCHOR_UPPER);
               ObjectSetInteger(0,_ln,OBJPROP_SELECTABLE,false);
            }
         }
      }
      else if((gBias == 0 || gBias == -1) && IFVGSM_${tf}_HasActiveBear())
      {
         gSetupActive = true;
         gSetupDir    = -1;
         gSetupSLHint = IFVGSM_${tf}_LatestBearUL();
         double _ul = IFVGSM_${tf}_LatestBearUL();
         double _ll = IFVGSM_${tf}_LatestBearLL();
         PrintFormat("[SETUP/${tf}] iFVG BEAR active | ul=%.5f ll=%.5f", _ul, _ll);
         datetime _ft = IFVGSM_${tf}_LatestBearFvgTime();
         if(_ft > 0)
         {
            for(int _ci=ObjectsTotal(0)-1;_ci>=0;_ci--){string _cn=ObjectName(0,_ci);if(StringFind(_cn,"4B_SETUP_")==0)ObjectDelete(0,_cn);}
            string _rn = StringFormat("4B_SETUP_%d",(int)TimeCurrent());
            datetime _rt2=(datetime)(iTime(InpSymbol,PERIOD_CURRENT,0)+PeriodSeconds(PERIOD_CURRENT)*30);
            if(ObjectCreate(0,_rn,OBJ_RECTANGLE,0,_ft,_ul,_rt2,_ll)){
               ObjectSetInteger(0,_rn,OBJPROP_COLOR,clrSalmon);
               ObjectSetInteger(0,_rn,OBJPROP_STYLE,STYLE_SOLID);
               ObjectSetInteger(0,_rn,OBJPROP_WIDTH,1);
               ObjectSetInteger(0,_rn,OBJPROP_BACK,true);
               ObjectSetInteger(0,_rn,OBJPROP_FILL,false);
               ObjectSetInteger(0,_rn,OBJPROP_SELECTABLE,false);
            }
            string _ln=StringFormat("4B_SETUP_LBL_%d",(int)TimeCurrent());
            if(ObjectCreate(0,_ln,OBJ_TEXT,0,iTime(InpSymbol,PERIOD_CURRENT,0),_ul)){
               ObjectSetString(0,_ln,OBJPROP_TEXT,StringFormat("${tf} SETUP: iFVG BEAR [%.5f-%.5f]",_ul,_ll));
               ObjectSetInteger(0,_ln,OBJPROP_COLOR,clrSalmon);
               ObjectSetInteger(0,_ln,OBJPROP_FONTSIZE,8);
               ObjectSetInteger(0,_ln,OBJPROP_ANCHOR,ANCHOR_LOWER);
               ObjectSetInteger(0,_ln,OBJPROP_SELECTABLE,false);
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
      case "choch":
      case "bos_choch": {
        const label = mod === "bos" ? "BOS" : mod === "choch" ? "CHoCH" : "BOS+CHoCH";
        const lookback = p(brainParams, "lookback", 20);
        parts.push(`
   // ${label}: fresh break in bias direction creates setup
   if(!gSetupActive)
   {
      double swH = iHigh(InpSymbol, ${TF}, 2);
      double swL = iLow (InpSymbol, ${TF}, 2);
      for(int i = 3; i <= ${lookback}; i++)
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

      case "snr":
      case "gap_snr": {
        const snrLookback = p(brainParams, "lookback", 20);
        const snrProx = p(brainParams, "expiry", 30);
        parts.push(`
   // S/R: price within ${snrProx} pts of ${snrLookback}-bar swing zone creates setup
   if(!gSetupActive)
   {
      double swH = iHigh(InpSymbol, ${TF}, 2);
      double swL = iLow (InpSymbol, ${TF}, 2);
      for(int i = 3; i <= ${snrLookback}; i++)
      {
         double h = iHigh(InpSymbol, ${TF}, i);
         double l = iLow (InpSymbol, ${TF}, i);
         if(h > swH) swH = h;
         if(l < swL) swL = l;
      }
      double pt  = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
      double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
      double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
      if(MathAbs(bid - swL) <= ${snrProx} * pt && (gBias == 0 || gBias == 1))
      {
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = swL;
         PrintFormat("[SETUP/${tf}] S/R BULL support=%.5f", swL);
      }
      else if(MathAbs(ask - swH) <= ${snrProx} * pt && (gBias == 0 || gBias == -1))
      {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = swH;
         PrintFormat("[SETUP/${tf}] S/R BEAR resistance=%.5f", swH);
      }
   }`);
        break;
      }

      case "engulfing": {
        // Reads from the verified inline EG/EF state machine (EGSM_${tf}_*).
        // MES wick-based + multi-candle aware. Setup is ACTIVE when a live EG/EF
        // zone exists in the bias direction. SL hint = the zone's far boundary.
        parts.push(`
   // Engulfing (MES) Setup: use verified EGSM — active when live EG/EF zone in bias direction
   if(!gSetupActive)
   {
      if((gBias == 0 || gBias == 1) && EGSM_${tf}_HasActiveBull())
      {
         gSetupActive = true; gSetupDir = 1;
         gSetupSLHint = EGSM_${tf}_LatestBullLL();
         PrintFormat("[SETUP/${tf}] ENGULF BULL zone active | ul=%.5f ll=%.5f",
                     EGSM_${tf}_LatestBullUL(), EGSM_${tf}_LatestBullLL());
      }
      else if((gBias == 0 || gBias == -1) && EGSM_${tf}_HasActiveBear())
      {
         gSetupActive = true; gSetupDir = -1;
         gSetupSLHint = EGSM_${tf}_LatestBearUL();
         PrintFormat("[SETUP/${tf}] ENGULF BEAR zone active | ul=%.5f ll=%.5f",
                     EGSM_${tf}_LatestBearUL(), EGSM_${tf}_LatestBearLL());
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
        const emaFast = p(brainParams, "fastPeriod", 21);
        const emaSlow = p(brainParams, "slowPeriod", 50);
        parts.push(`
   // EMA alignment: fast(${emaFast}) > slow(${emaSlow}) in bias direction creates setup
   // Real iMA handles, drawn on the chart via B4_MA.
   if(!gSetupActive)
   {
      double fastMA = B4_MAval(B4_MA(${TF}, ${emaFast}, MODE_EMA), 1);
      double slowMA = B4_MAval(B4_MA(${TF}, ${emaSlow}, MODE_EMA), 1);
      if(fastMA > slowMA && (gBias == 0 || gBias == 1))
      {
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

      case "bb": {
        // Bollinger Bands: price above/below 20-SMA midline in bias direction
        const bbPeriod = p(brainParams, "period", 20);
        parts.push(`
   // Bollinger Bands: price relative to ${bbPeriod}-bar midline creates setup
   if(!gSetupActive)
   {
      double _bbSum = 0.0;
      for(int i = 1; i <= ${bbPeriod}; i++) _bbSum += iClose(InpSymbol, ${TF}, i);
      double _bbMid = _bbSum / ${bbPeriod}.0;
      double _c1 = iClose(InpSymbol, ${TF}, 1);
      if(_c1 > _bbMid && (gBias == 0 || gBias == 1))
      {
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = _bbMid;
         PrintFormat("[SETUP/${tf}] BB BULL price above midline=%.5f", _bbMid);
      }
      else if(_c1 < _bbMid && (gBias == 0 || gBias == -1))
      {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = _bbMid;
         PrintFormat("[SETUP/${tf}] BB BEAR price below midline=%.5f", _bbMid);
      }
   }`);
        break;
      }

      case "swing_structure": {
        const ssLookback = p(brainParams, "lookback", 50);
        parts.push(`
   // Swing Structure: price in upper/lower half of ${ssLookback}-bar range
   if(!gSetupActive)
   {
      double _ssH = iHigh(InpSymbol, ${TF}, 1), _ssL = iLow(InpSymbol, ${TF}, 1);
      for(int i = 2; i <= ${ssLookback}; i++) {
         double _h = iHigh(InpSymbol, ${TF}, i), _l = iLow(InpSymbol, ${TF}, i);
         if(_h > _ssH) _ssH = _h;
         if(_l < _ssL) _ssL = _l;
      }
      double _ssMid = (_ssH + _ssL) / 2.0;
      double _c1 = iClose(InpSymbol, ${TF}, 1);
      if(_c1 > _ssMid && (gBias == 0 || gBias == 1))
      {
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = _ssL;
         PrintFormat("[SETUP/${tf}] SWING STRUCT BULL mid=%.5f", _ssMid);
      }
      else if(_c1 < _ssMid && (gBias == 0 || gBias == -1))
      {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = _ssH;
         PrintFormat("[SETUP/${tf}] SWING STRUCT BEAR mid=%.5f", _ssMid);
      }
   }`);
        break;
      }

      case "breakout": {
        const boLookback = p(brainParams, "lookback", 20);
        parts.push(`
   // Breakout: price closed beyond ${boLookback}-bar range — momentum setup
   if(!gSetupActive)
   {
      double _boH = iHigh(InpSymbol, ${TF}, 2), _boL = iLow(InpSymbol, ${TF}, 2);
      for(int i = 3; i <= ${boLookback}; i++) {
         double _h = iHigh(InpSymbol, ${TF}, i), _l = iLow(InpSymbol, ${TF}, i);
         if(_h > _boH) _boH = _h;
         if(_l < _boL) _boL = _l;
      }
      double _c1 = iClose(InpSymbol, ${TF}, 1);
      if(_c1 > _boH && (gBias == 0 || gBias == 1))
      {
         gSetupActive = true; gSetupDir = 1; gSetupSLHint = _boL;
         PrintFormat("[SETUP/${tf}] BREAKOUT BULL level=%.5f", _boH);
      }
      else if(_c1 < _boL && (gBias == 0 || gBias == -1))
      {
         gSetupActive = true; gSetupDir = -1; gSetupSLHint = _boH;
         PrintFormat("[SETUP/${tf}] BREAKOUT BEAR level=%.5f", _boL);
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
   bool _wasActive = gSetupActive;
   gSetupActive = false;   // Reset — re-detect every bar
   gSetupDir    = 0;
   // If setup just expired, remove stale zone rectangles
   if(_wasActive)
   {
      for(int _ci = ObjectsTotal(0)-1; _ci >= 0; _ci--)
      {
         string _cn = ObjectName(0, _ci);
         if(StringFind(_cn, "4B_SETUP_") == 0) ObjectDelete(0, _cn);
      }
   }
${detectionBody}
}
`;
}
