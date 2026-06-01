/**
 * Direction Brain Generator
 *
 * gBias is PERSISTENT: 1=BULL, -1=BEAR. Only flips when opposite break fires.
 *
 * Logic:
 *   Single module  → the module directly sets gBias when it detects.
 *   Multiple modules → AND logic: ALL modules must agree on the SAME direction
 *                       before gBias changes. This lets users combine e.g.
 *                       BOS + FVG_INVERSION and require both to confirm.
 */

import type { BrainConfig, BrainModuleType } from "@/types/blueprint";

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

/** Returns code that sets `int <varName>` to 1 (bull), -1 (bear), or 0 (none). */
function genModuleSignal(
  mod: BrainModuleType | string,
  tf: string,
  TF: string,
  varName: string,
  params?: Record<string, unknown>,
): string {
  switch (mod) {
    case "bos":
    case "choch":
    case "bos_choch": {
      const label = mod === "bos" ? "BOS" : mod === "choch" ? "CHoCH" : "BOS+CHoCH";
      const lookback = p(params, "lookback", 20);
      return `
   // ${label}: close beyond ${lookback}-bar swing high/low
   {
      double _swH = iHigh(InpSymbol, ${TF}, 2);
      double _swL = iLow (InpSymbol, ${TF}, 2);
      for(int _k = 3; _k <= ${lookback}; _k++) {
         double _h = iHigh(InpSymbol, ${TF}, _k);
         double _l = iLow (InpSymbol, ${TF}, _k);
         if(_h > _swH) _swH = _h;
         if(_l < _swL) _swL = _l;
      }
      double _c1 = iClose(InpSymbol, ${TF}, 1);
      if(_c1 > _swH)       ${varName} = 1;
      else if(_c1 < _swL)  ${varName} = -1;
   }`;
    }

    case "fvg_inversion": {
      // Uses the inline Phase 3 state machine (IFVGSM_${tf}_*).
      // Signal fires when an iFVG reaches CONFIRMED state (ACTIVE→RETESTED→CONFIRMED).
      // The state machine instance is named by TF so Direction and Execution brains
      // can share the same machine when on the same timeframe.
      return `
   // FVG Inversion: read from the Phase 3 inline state machine (IFVGSM_${tf}_)
   // CONFIRMED = price retested the iFVG zone and closed back outside → quality setup
   if(IFVGSM_${tf}_BullJustConfirmed()) ${varName} = 1;
   if(IFVGSM_${tf}_BearJustConfirmed()) ${varName} = -1;`;
    }

    case "fvg": {
      // Most recent 3-candle gap direction
      return `
   // FVG: 3-candle imbalance direction
   {
      for(int _i = 3; _i <= 20 && ${varName} == 0; _i++)
      {
         double _l_i   = iLow (InpSymbol, ${TF}, _i);
         double _h_ip2 = iHigh(InpSymbol, ${TF}, _i + 2);
         double _h_i   = iHigh(InpSymbol, ${TF}, _i);
         double _l_ip2 = iLow (InpSymbol, ${TF}, _i + 2);
         if(_l_i > _h_ip2) ${varName} = 1;
         else if(_h_i < _l_ip2) ${varName} = -1;
      }
   }`;
    }

    case "order_block": {
      return `
   // Order Block: strong displacement candle direction
   {
      double _o1 = iOpen (InpSymbol, ${TF}, 1);
      double _c1 = iClose(InpSymbol, ${TF}, 1);
      double _h1 = iHigh (InpSymbol, ${TF}, 1);
      double _l1 = iLow  (InpSymbol, ${TF}, 1);
      double _body = MathAbs(_c1 - _o1);
      double _range = _h1 - _l1;
      if(_range > 0 && _body >= _range * 0.6)
         ${varName} = (_c1 > _o1) ? 1 : -1;
   }`;
    }

    case "liqsweep": {
      return `
   // Liq Sweep: wick beyond 15-bar extreme then closes back → direction of bounce
   {
      double _swH = iHigh(InpSymbol, ${TF}, 2);
      double _swL = iLow (InpSymbol, ${TF}, 2);
      for(int _k = 3; _k <= 15; _k++) {
         double _h = iHigh(InpSymbol, ${TF}, _k);
         double _l = iLow (InpSymbol, ${TF}, _k);
         if(_h > _swH) _swH = _h;
         if(_l < _swL) _swL = _l;
      }
      double _h1 = iHigh (InpSymbol, ${TF}, 1);
      double _l1 = iLow  (InpSymbol, ${TF}, 1);
      double _c1 = iClose(InpSymbol, ${TF}, 1);
      if(_h1 > _swH && _c1 < _swH)       ${varName} = -1;
      else if(_l1 < _swL && _c1 > _swL)  ${varName} = 1;
   }`;
    }

    case "ema": {
      const fast = p(params, "fastPeriod", 21);
      const slow = p(params, "slowPeriod", 50);
      return `
   // EMA: fast(${fast}) vs slow(${slow}) alignment — real iMA, drawn on chart
   {
      int _hF = B4_MA(${TF}, ${fast}, MODE_EMA);
      int _hS = B4_MA(${TF}, ${slow}, MODE_EMA);
      double _fast = B4_MAval(_hF, 1);
      double _slow = B4_MAval(_hS, 1);
      ${varName} = (_fast > _slow) ? 1 : (_fast < _slow ? -1 : 0);
   }`;
    }

    case "engulfing": {
      return `
   // Engulfing: strong reversal candle
   {
      double _o1=iOpen(InpSymbol,${TF},1), _c1=iClose(InpSymbol,${TF},1);
      double _o2=iOpen(InpSymbol,${TF},2), _c2=iClose(InpSymbol,${TF},2);
      if(_c1>_o1 && _c2<_o2 && _c1>=_o2 && _o1<=_c2)      ${varName} = 1;
      else if(_c1<_o1 && _c2>_o2 && _c1<=_o2 && _o1>=_c2) ${varName} = -1;
   }`;
    }

    case "pin_bar": {
      return `
   // Pin Bar: long-wick rejection
   {
      double _o=iOpen(InpSymbol,${TF},1), _c=iClose(InpSymbol,${TF},1);
      double _h=iHigh(InpSymbol,${TF},1), _l=iLow(InpSymbol,${TF},1);
      double _rng=_h-_l;
      if(_rng > 0) {
         double _body=MathAbs(_c-_o);
         double _lw=MathMin(_o,_c)-_l, _uw=_h-MathMax(_o,_c);
         if(_lw>=_rng*0.6 && _body<=_rng*0.35)      ${varName} = 1;
         else if(_uw>=_rng*0.6 && _body<=_rng*0.35) ${varName} = -1;
      }
   }`;
    }

    case "snr": {
      return `
   // S/R: price above/below 20-bar midpoint
   {
      double _high=iHigh(InpSymbol,${TF},1), _low=iLow(InpSymbol,${TF},1);
      for(int _k=2;_k<=20;_k++){
         double _h=iHigh(InpSymbol,${TF},_k),_l=iLow(InpSymbol,${TF},_k);
         if(_h>_high)_high=_h; if(_l<_low)_low=_l;
      }
      double _mid=(_high+_low)/2.0;
      double _c1=iClose(InpSymbol,${TF},1);
      ${varName} = (_c1>_mid) ? 1 : -1;
   }`;
    }

    case "bb": {
      return `
   // Bollinger midline: price above/below 20-SMA
   {
      double _sum=0.0;
      for(int _k=1;_k<=20;_k++) _sum+=iClose(InpSymbol,${TF},_k);
      double _mid=_sum/20.0;
      double _c1=iClose(InpSymbol,${TF},1);
      ${varName} = (_c1>_mid) ? 1 : -1;
   }`;
    }

    case "swing_structure": {
      return `
   // Swing Structure: close beyond 50-bar extreme
   {
      double _swH=iHigh(InpSymbol,${TF},1), _swL=iLow(InpSymbol,${TF},1);
      for(int _k=2;_k<=50;_k++){
         double _h=iHigh(InpSymbol,${TF},_k),_l=iLow(InpSymbol,${TF},_k);
         if(_h>_swH)_swH=_h; if(_l<_swL)_swL=_l;
      }
      double _c0=iClose(InpSymbol,${TF},0);
      if(_c0>_swH)      ${varName}=1;
      else if(_c0<_swL) ${varName}=-1;
   }`;
    }

    case "breakout":
    case "gap_snr": {
      return `
   // Breakout: close beyond 20-bar range
   {
      double _rH=iHigh(InpSymbol,${TF},1), _rL=iLow(InpSymbol,${TF},1);
      for(int _k=2;_k<=20;_k++){
         double _h=iHigh(InpSymbol,${TF},_k),_l=iLow(InpSymbol,${TF},_k);
         if(_h>_rH)_rH=_h; if(_l<_rL)_rL=_l;
      }
      double _c1=iClose(InpSymbol,${TF},1);
      if(_c1>_rH)      ${varName}=1;
      else if(_c1<_rL) ${varName}=-1;
   }`;
    }

    default:
      return `\n   // Module '${mod}' on ${tf}: signal detection not yet implemented`;
  }
}

export function genDirectionBrain(brain: BrainConfig | undefined): string {
  if (!brain) {
    return `
// ─── Direction Brain: disabled ───────────────────────────────────────────────
void Direction_Brain_Execute() {}
`;
  }

  const modules = brain.modules ?? [];
  const tf = brain.timeframe ?? "D1";
  const TF = tfConst(tf);

  if (modules.length === 0) {
    return `
void Direction_Brain_Execute() {}
`;
  }

  const brainParams = brain.params as Record<string, unknown> | undefined;

  // Single module: detect directly into gBias
  if (modules.length === 1) {
    const mod = modules[0];
    // Reuse genModuleSignal but write to gBias directly
    const sigCode = genModuleSignal(mod, tf, TF, "_sig", brainParams);
    return `
// ─── Direction Brain: ${mod.toUpperCase()} @ ${tf} ──────────────────────────────────────
// gBias is PERSISTENT — only flips when opposite break detected.
void Direction_Brain_Execute()
{
   int _sig = 0;
${sigCode}
   if(_sig != 0 && gBias != _sig)
   {
      PrintFormat("[DIR/${tf}] ${mod.toUpperCase()} %s", _sig>0?"BULL":"BEAR");
      gBias = _sig;
      // Draw direction label
      for(int _oi=ObjectsTotal(0)-1;_oi>=0;_oi--) {
         string _on=ObjectName(0,_oi);
         if(StringFind(_on,"4B_DIR_")==0) ObjectDelete(0,_on);
      }
      string _dlbl=StringFormat("4B_DIR_LBL_%d",(int)TimeCurrent());
      datetime _dt=iTime(InpSymbol,PERIOD_CURRENT,1);
      double _dp=_sig>0?iLow(InpSymbol,PERIOD_CURRENT,1)*0.9997:iHigh(InpSymbol,PERIOD_CURRENT,1)*1.0003;
      if(ObjectCreate(0,_dlbl,OBJ_TEXT,0,_dt,_dp)){
         ObjectSetString(0,_dlbl,OBJPROP_TEXT,StringFormat("${tf} ${mod.toUpperCase()} %s ✓",_sig>0?"BULL":"BEAR"));
         ObjectSetInteger(0,_dlbl,OBJPROP_COLOR,_sig>0?clrDodgerBlue:clrOrangeRed);
         ObjectSetInteger(0,_dlbl,OBJPROP_FONTSIZE,9);
         ObjectSetInteger(0,_dlbl,OBJPROP_ANCHOR,_sig>0?ANCHOR_UPPER:ANCHOR_LOWER);
      }
      string _dvl=StringFormat("4B_DIR_VL_%d",(int)TimeCurrent());
      if(ObjectCreate(0,_dvl,OBJ_VLINE,0,_dt,0)){
         ObjectSetInteger(0,_dvl,OBJPROP_COLOR,_sig>0?clrDodgerBlue:clrOrangeRed);
         ObjectSetInteger(0,_dvl,OBJPROP_STYLE,STYLE_DOT);
         ObjectSetInteger(0,_dvl,OBJPROP_BACK,true);
         ObjectSetInteger(0,_dvl,OBJPROP_SELECTABLE,false);
      }
   }
}
`;
  }

  // Multiple modules: AND logic — all must agree on the same direction
  const varDecls = modules.map((m, i) => `   int _sig${i} = 0;  // ${m}`).join("\n");
  const detections = modules
    .map((m, i) => genModuleSignal(m, tf, TF, `_sig${i}`, brainParams))
    .join("\n");

  // AND check: all non-zero and all equal
  const allVars = modules.map((_, i) => `_sig${i}`);
  const nonZeroCheck = allVars.map((v) => `${v} != 0`).join(" && ");
  const agreeCheck = allVars
    .slice(1)
    .map((v) => `${v} == _sig0`)
    .join(" && ");

  return `
// ─── Direction Brain: ${modules.map((m) => m.toUpperCase()).join(" + ")} @ ${tf} ─────────────
// AND logic: ALL modules must confirm the SAME direction before gBias changes.
// gBias is PERSISTENT — only flips when opposite break fires.
void Direction_Brain_Execute()
{
${varDecls}

${detections}

   // AND gate: all signals must be non-zero and agree
   bool _allNonZero = (${nonZeroCheck});
   bool _allAgree   = _allNonZero && (${modules.length > 1 ? agreeCheck : "true"});
   if(_allAgree)
   {
      int _combined = _sig0;
      if(gBias != _combined)
      {
         PrintFormat("[DIR/${tf}] ${modules.map((m) => m.toUpperCase()).join("+")} %s confirmed",
                     _combined>0?"BULL":"BEAR");
         gBias = _combined;

         // ── Chart: draw direction label at current bar ────────────────────────
         // Clean up old direction objects first
         for(int _oi = ObjectsTotal(0) - 1; _oi >= 0; _oi--)
         {
            string _on = ObjectName(0, _oi);
            if(StringFind(_on, "4B_DIR_") == 0) ObjectDelete(0, _on);
         }
         // Direction label
         string _dlbl = StringFormat("4B_DIR_LBL_%d", (int)TimeCurrent());
         datetime _dt = iTime(InpSymbol, PERIOD_CURRENT, 1);
         double   _dp = _combined > 0
                        ? iLow (InpSymbol, PERIOD_CURRENT, 1) * 0.9997
                        : iHigh(InpSymbol, PERIOD_CURRENT, 1) * 1.0003;
         if(ObjectCreate(0, _dlbl, OBJ_TEXT, 0, _dt, _dp))
         {
            string _dtxt = StringFormat("${tf} DIR: ${modules.map((m) => m.toUpperCase()).join("+")} %s ✓",
                                         _combined > 0 ? "BULL" : "BEAR");
            ObjectSetString (0, _dlbl, OBJPROP_TEXT,     _dtxt);
            ObjectSetInteger(0, _dlbl, OBJPROP_COLOR,    _combined>0 ? clrDodgerBlue : clrOrangeRed);
            ObjectSetInteger(0, _dlbl, OBJPROP_FONTSIZE, 9);
            ObjectSetInteger(0, _dlbl, OBJPROP_ANCHOR,   _combined>0 ? ANCHOR_UPPER : ANCHOR_LOWER);
         }
         // Vertical dashed line at the direction change bar
         string _dvline = StringFormat("4B_DIR_VL_%d", (int)TimeCurrent());
         if(ObjectCreate(0, _dvline, OBJ_VLINE, 0, _dt, 0))
         {
            ObjectSetInteger(0, _dvline, OBJPROP_COLOR,   _combined>0 ? clrDodgerBlue : clrOrangeRed);
            ObjectSetInteger(0, _dvline, OBJPROP_STYLE,   STYLE_DOT);
            ObjectSetInteger(0, _dvline, OBJPROP_WIDTH,   1);
            ObjectSetInteger(0, _dvline, OBJPROP_BACK,    true);
            ObjectSetInteger(0, _dvline, OBJPROP_SELECTABLE, false);
         }
      }
      gBias = _combined;
   }
}
`;
}
