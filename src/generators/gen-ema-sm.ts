/**
 * Inline EMA State Machine Generator (cross → retest → confirmation sequence)
 *
 * The canonical EMA pullback setup, as a verified state machine so the AI WIRES
 * it instead of hand-writing (and collapsing) the phases:
 *
 *   IDLE
 *     → CROSSED   : the fast/slow EMA CROSSES in the bias direction (12 crosses
 *                   48 up for bull / down for bear). This arms the setup.
 *                   (Skipped when requireCross = false.)
 *     → ARMED     : after the cross, price RETESTS the slow EMA (within
 *                   retestPoints). The retest bar only arms — it never fires.
 *     → CONFIRMED : a LATER bar CLOSES outside the fast EMA in the bias
 *                   direction → entry next bar. SL = pullback swing.
 *   After a confirmation, the machine normally returns to CROSSED (same direction)
 *   and waits for the next slow-EMA retest + fast-EMA close — no new cross required
 *   until an opposite cross flips bias (repeatAfterConfirmation=true, default).
 *   Set repeatAfterConfirmation=false to require a fresh cross after each trade.
 *   Invalidation: opposite fast/slow cross only — a close through the slow EMA
 *   during the test does NOT invalidate if price later closes beyond the fast EMA.
 *
 * Direction is supplied externally (the higher-TF gBias) so the lower-TF instance
 * aligns with the trend. Bias() is exposed for the Direction Brain role.
 *
 * Roles → API:
 *   Direction : EMASM_{id}_Bias()
 *   Setup     : EMASM_{id}_SetupActive()  (cross happened — setup live)
 *   Execution : EMASM_{id}_JustConfirmed() (close outside fast after retest)
 *
 * EMAs are real iMA handles drawn via B4_MA, read with a GUARDED copy (never the
 * 0.0 fallback) so unready buffers can't produce phantom signals.
 *
 * Full API:
 *   EMASM_{id}_Reset()
 *   EMASM_{id}_Tick(int bias)
 *   EMASM_{id}_Bias()           — own fast/slow alignment (Direction)
 *   EMASM_{id}_SetupActive()    — CROSSED or ARMED (Setup)
 *   EMASM_{id}_RetestActive()   — ARMED only (retest in progress)
 *   EMASM_{id}_ActiveDir()      — direction of the live setup
 *   EMASM_{id}_ActiveSL()       — swing SL hint while live
 *   EMASM_{id}_JustConfirmed()  — entry fired this bar (Execution)
 *   EMASM_{id}_ConfirmDir()     — direction of the confirmation
 *   EMASM_{id}_ConfirmSL()      — swing SL at confirmation
 */

export function genEmaSM(
  id: string,
  TF: string,
  tf: string,
  fast = 12,
  slow = 48,
  retestPoints = 0, // retest tolerance in POINTS; 0 means the candle must touch the slow EMA
  requireCross = true, // require an aligned fast/slow cross before the retest
  repeatAfterConfirmation = true, // after confirm: stay in cross direction, wait for next retest+close
  allPeriods?: number[],
): string {
  const periods =
    allPeriods && allPeriods.length > 0
      ? [...new Set(allPeriods)].sort((a, b) => a - b)
      : [Math.min(fast, slow), Math.max(fast, slow)];
  const singleMode = periods.length === 1;
  const multiMode = periods.length > 2;
  const effFast = periods[0];
  const effSlow = periods[periods.length - 1];
  const P = `EMASM_${id}_`;
  const RC = singleMode ? "false" : requireCross ? "true" : "false";
  const REPEAT = repeatAfterConfirmation ? "true" : "false";
  const periodList = periods.join(", ");
  const modeNote = singleMode
    ? "single EMA"
    : multiMode
      ? `stack [${periodList}] cross ${effFast}/${effSlow}`
      : `dual ${effFast}/${effSlow}`;

  const biasFn = singleMode
    ? `
int ${P}Bias()
{
   double e, c = iClose(InpSymbol, ${TF}, 1);
   int h = B4_MA(${TF}, ${effFast}, MODE_EMA);
   if(!${P}Val(h, 1, e)) return 0;
   return (c > e) ? 1 : (c < e ? -1 : 0);
}`
    : multiMode
      ? `
int ${P}Bias()
{
   int _ps[] = {${periodList}};
   double _v[];
   ArrayResize(_v, ArraySize(_ps));
   for(int _i = 0; _i < ArraySize(_ps); _i++)
   {
      if(!${P}Val(B4_MA(${TF}, _ps[_i], MODE_EMA), 1, _v[_i])) return 0;
   }
   bool _bull = true, _bear = true;
   for(int _i = 0; _i < ArraySize(_ps) - 1; _i++)
   {
      if(_v[_i] <= _v[_i + 1]) _bull = false;
      if(_v[_i] >= _v[_i + 1]) _bear = false;
   }
   if(_bull) return 1;
   if(_bear) return -1;
   return 0;
}`
      : `
int ${P}Bias()
{
   double f, s;
   int hF = B4_MA(${TF}, ${effFast}, MODE_EMA);
   int hS = B4_MA(${TF}, ${effSlow}, MODE_EMA);
   if(!${P}Val(hF, 1, f) || !${P}Val(hS, 1, s)) return 0;
   return (f > s) ? 1 : (f < s ? -1 : 0);
}`;

  return `
//+------------------------------------------------------------------+
//| EMA Cross→Retest State Machine — ${tf} (${id})                  |
//| ${modeNote} retest=${retestPoints}pts requireCross=${RC} repeat=${REPEAT} |
//| IDLE → CROSSED → ARMED (retest) → CONFIRMED (close outside fast) |
//+------------------------------------------------------------------+
#define ${P}IDLE    0
#define ${P}CROSSED 1
#define ${P}ARMED   2

int    ${P}phase        = ${P}IDLE;
int    ${P}activeDir    = 0;        //  1 bull setup,  -1 bear setup
double ${P}swingLow     = 0.0;
double ${P}swingHigh    = 0.0;
bool   ${P}justConfirmed = false;
int    ${P}confirmDir   = 0;
double ${P}confirmSL    = 0.0;
bool   ${P}consume      = false;
bool   ${P}bootstrapUsed = false;
datetime ${P}lastBar    = 0;

void ${P}Reset()
{
   for(int _oi = ObjectsTotal(0) - 1; _oi >= 0; _oi--)
   {
      string _on = ObjectName(0, _oi);
      if(StringFind(_on, "4B_EMA_${tf}_") == 0) ObjectDelete(0, _on);
   }
   ${P}phase = ${P}IDLE; ${P}activeDir = 0;
   ${P}swingLow = 0.0; ${P}swingHigh = 0.0;
   ${P}justConfirmed = false; ${P}confirmDir = 0; ${P}confirmSL = 0.0;
   ${P}consume = false; ${P}bootstrapUsed = false; ${P}lastBar = 0;
}

// Guarded EMA read — returns false (not 0.0) when the buffer is not ready.
bool ${P}Val(int handle, int shift, double &out)
{
   double _b[];
   if(handle == INVALID_HANDLE || CopyBuffer(handle, 0, shift, 1, _b) != 1) return false;
   out = _b[0];
   return true;
}

// Own alignment (Direction Brain role). Draws the EMAs via B4_MA.
${biasFn}

bool ${P}BootstrapCross(int bias, int hF, int hS)
{
   if(${singleMode ? "true" : "false"}) return false;
   if(bias == 0) return false;

   double fNow, sNow;
   if(!${P}Val(hF, 1, fNow) || !${P}Val(hS, 1, sNow)) return false;
   if(bias == 1 && fNow <= sNow) return false;
   if(bias == -1 && fNow >= sNow) return false;

   for(int shift = 2; shift <= 200; shift++)
   {
      double fCur, sCur, fPrev, sPrev;
      if(!${P}Val(hF, shift, fCur) || !${P}Val(hS, shift, sCur)) break;
      if(!${P}Val(hF, shift + 1, fPrev) || !${P}Val(hS, shift + 1, sPrev)) break;

      bool bullCross = (fPrev <= sPrev && fCur > sCur);
      bool bearCross = (fPrev >= sPrev && fCur < sCur);

      if(bias == 1 && bullCross)
      {
         ${P}phase = ${P}CROSSED; ${P}activeDir = 1; ${P}bootstrapUsed = true;
         PrintFormat("[EMASM_${tf}] BULL cross bootstrapped from recent history");
         B4_DebugMark("EMA_${tf}_BULL_BOOT", ${TF}, 1, iLow(InpSymbol, ${TF}, 1), clrDodgerBlue, "RECENT BULL CROSS");
         return true;
      }
      if(bias == -1 && bearCross)
      {
         ${P}phase = ${P}CROSSED; ${P}activeDir = -1; ${P}bootstrapUsed = true;
         PrintFormat("[EMASM_${tf}] BEAR cross bootstrapped from recent history");
         B4_DebugMark("EMA_${tf}_BEAR_BOOT", ${TF}, 1, iHigh(InpSymbol, ${TF}, 1), clrOrangeRed, "RECENT BEAR CROSS");
         return true;
      }
      if((bias == 1 && bearCross) || (bias == -1 && bullCross)) return false;
   }
   return false;
}

void ${P}Tick(int bias)
{
   datetime _bt = iTime(InpSymbol, ${TF}, 0);
   if(_bt == ${P}lastBar) return;          // once per bar (safe if Setup+Exec both call)
   ${P}lastBar = _bt;
   ${P}justConfirmed = false;
   if(${P}consume)
   {
      if(${REPEAT} && ${P}confirmDir == bias && bias != 0)
      {
         ${P}phase = ${P}CROSSED; ${P}activeDir = ${P}confirmDir;
      }
      else
      {
         ${P}phase = ${P}IDLE; ${P}activeDir = 0;
      }
      ${P}consume = false;
   }

   double f1, s1, f2, s2;
   int hF = B4_MA(${TF}, ${effFast}, MODE_EMA);
   int hS = B4_MA(${TF}, ${effSlow}, MODE_EMA);
   if(!${P}Val(hF, 1, f1) || !${P}Val(hS, 1, s1)) return;   // buffers not ready
   if(!${P}Val(hF, 2, f2) || !${P}Val(hS, 2, s2)) return;

   double hi = iHigh (InpSymbol, ${TF}, 1);
   double lo = iLow  (InpSymbol, ${TF}, 1);
   double cl = iClose(InpSymbol, ${TF}, 1);
   double tol = ${retestPoints} * SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   bool bullRetestSlow = (lo <= s1 + tol && hi >= s1 - tol);
   bool bearRetestSlow = (hi >= s1 - tol && lo <= s1 + tol);

   bool bullCross = (f2 <= s2 && f1 > s1);   // 12 crossed ABOVE 48 on the last bar
   bool bearCross = (f2 >= s2 && f1 < s1);   // 12 crossed BELOW 48 on the last bar
   bool requireCross = ${RC};

   if(bias == 0) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; return; }   // no trend
   if(${P}activeDir != 0 && ${P}activeDir != bias) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; }

   if(bias == 1)                                   // ── BULL ───────────────────
   {
      if(${P}phase == ${P}IDLE)
      {
         if(!requireCross && bullRetestSlow)        // retest-only mode: arm directly
         { ${P}phase = ${P}ARMED; ${P}activeDir = 1; ${P}swingLow = lo;
           B4_DebugMark("EMA_${tf}_BULL_TEST", ${TF}, 1, lo, clrGold, "SLOW EMA TEST"); }
         else if(requireCross && bullCross)         // cross arms the setup
         { ${P}phase = ${P}CROSSED; ${P}activeDir = 1;
           B4_DebugMark("EMA_${tf}_BULL_CROSS", ${TF}, 1, lo, clrDodgerBlue, "BULL CROSS");
           PrintFormat("[EMASM_${tf}] BULL cross — setup armed (12 over 48)");
           if(bullRetestSlow)
           { ${P}phase = ${P}ARMED; ${P}swingLow = lo;
             if(cl > f1)
             { ${P}justConfirmed = true; ${P}confirmDir = 1; ${P}confirmSL = ${P}swingLow; ${P}consume = true;
               B4_DebugMark("EMA_${tf}_BULL_CONFIRM", ${TF}, 1, lo, clrLime, "CLOSE CONFIRMED");
               PrintFormat("[EMASM_${tf}] BULL CONFIRMED same bar after cross close=%.5f > fast=%.5f", cl, f1); } } }
         else if(requireCross && !${P}bootstrapUsed) ${P}BootstrapCross(1, hF, hS);
      }
      else if(${P}phase == ${P}CROSSED)
      {
         if(bearCross) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; }      // opposite cross only
         else if(bullRetestSlow)                    // candle touched the slow EMA
         { ${P}phase = ${P}ARMED; ${P}swingLow = lo;
           B4_DebugMark("EMA_${tf}_BULL_TEST", ${TF}, 1, lo, clrGold, "SLOW EMA TEST");
           PrintFormat("[EMASM_${tf}] BULL retest of slow=%.5f low=%.5f", s1, lo);
           if(cl > f1)
           { ${P}justConfirmed = true; ${P}confirmDir = 1; ${P}confirmSL = ${P}swingLow; ${P}consume = true;
             B4_DebugMark("EMA_${tf}_BULL_CONFIRM", ${TF}, 1, lo, clrLime, "CLOSE CONFIRMED");
             PrintFormat("[EMASM_${tf}] BULL CONFIRMED same bar close=%.5f > fast=%.5f SL=%.5f", cl, f1, ${P}swingLow); } }
      }
      else                                          // ARMED
      {
         if(lo < ${P}swingLow) ${P}swingLow = lo;
         if(bearCross) { ${P}phase = ${P}IDLE; ${P}activeDir = 0;
            B4_DebugMark("EMA_${tf}_BULL_INVALID", ${TF}, 1, cl, clrTomato, "BULL OPPOSITE CROSS");
            PrintFormat("[EMASM_${tf}] BULL setup invalidated by opposite cross"); }
         else if(cl > f1)                           // confirmation: close above fast
         { ${P}justConfirmed = true; ${P}confirmDir = 1; ${P}confirmSL = ${P}swingLow; ${P}consume = true;
           B4_DebugMark("EMA_${tf}_BULL_CONFIRM", ${TF}, 1, lo, clrLime, "CLOSE CONFIRMED");
           PrintFormat("[EMASM_${tf}] BULL CONFIRMED close=%.5f > fast=%.5f SL=%.5f", cl, f1, ${P}swingLow); }
      }
   }
   else                                            // ── BEAR ───────────────────
   {
      if(${P}phase == ${P}IDLE)
      {
         if(!requireCross && bearRetestSlow)
         { ${P}phase = ${P}ARMED; ${P}activeDir = -1; ${P}swingHigh = hi; }
         else if(requireCross && bearCross)
         { ${P}phase = ${P}CROSSED; ${P}activeDir = -1;
           PrintFormat("[EMASM_${tf}] BEAR cross — setup armed (12 under 48)");
           if(bearRetestSlow)
           { ${P}phase = ${P}ARMED; ${P}swingHigh = hi;
             if(cl < f1)
             { ${P}justConfirmed = true; ${P}confirmDir = -1; ${P}confirmSL = ${P}swingHigh; ${P}consume = true;
               PrintFormat("[EMASM_${tf}] BEAR CONFIRMED same bar after cross close=%.5f < fast=%.5f", cl, f1); } } }
         else if(requireCross && !${P}bootstrapUsed) ${P}BootstrapCross(-1, hF, hS);
      }
      else if(${P}phase == ${P}CROSSED)
      {
         if(bullCross) { ${P}phase = ${P}IDLE; ${P}activeDir = 0; }
         else if(bearRetestSlow)
         { ${P}phase = ${P}ARMED; ${P}swingHigh = hi;
           PrintFormat("[EMASM_${tf}] BEAR retest of slow=%.5f high=%.5f", s1, hi);
           if(cl < f1)
           { ${P}justConfirmed = true; ${P}confirmDir = -1; ${P}confirmSL = ${P}swingHigh; ${P}consume = true;
             PrintFormat("[EMASM_${tf}] BEAR CONFIRMED same bar close=%.5f < fast=%.5f SL=%.5f", cl, f1, ${P}swingHigh); } }
      }
      else
      {
         if(hi > ${P}swingHigh) ${P}swingHigh = hi;
         if(bullCross) { ${P}phase = ${P}IDLE; ${P}activeDir = 0;
            PrintFormat("[EMASM_${tf}] BEAR setup invalidated by opposite cross"); }
         else if(cl < f1)
         { ${P}justConfirmed = true; ${P}confirmDir = -1; ${P}confirmSL = ${P}swingHigh; ${P}consume = true;
           PrintFormat("[EMASM_${tf}] BEAR CONFIRMED close=%.5f < fast=%.5f SL=%.5f", cl, f1, ${P}swingHigh); }
      }
   }
   ${P}DrawPhase();
}

// ── Chart visualization: phase label at current bar ─────────────────
void ${P}DrawPhase()
{
   string _pn = "4B_EMA_${tf}_phase";
   if(${P}phase == ${P}IDLE)
   {
      ObjectDelete(0, _pn);
      return;
   }
   datetime _bt = iTime(InpSymbol, ${TF}, 1);
   string _ptxt = ${P}phase == ${P}CROSSED ? (${P}activeDir==1?"EMA-X+":"EMA-X-")
               : ${P}phase == ${P}ARMED   ? (${P}activeDir==1?"EMA-T+":"EMA-T-")
               :                            (${P}activeDir==1?"EMA-C+":"EMA-C-");
   double _lvl  = ${P}activeDir == 1
      ? (${P}swingLow  > 0 ? ${P}swingLow  : iLow (InpSymbol, ${TF}, 1))
      : (${P}swingHigh > 0 ? ${P}swingHigh : iHigh(InpSymbol, ${TF}, 1));
   color  _col  = ${P}phase == ${P}ARMED ? clrGold : (${P}activeDir==1?clrCornflowerBlue:clrSalmon);
   if(ObjectFind(0, _pn) < 0) ObjectCreate(0, _pn, OBJ_TEXT, 0, _bt, _lvl);
   ObjectSetInteger(0, _pn, OBJPROP_TIME,       _bt);
   ObjectSetDouble (0, _pn, OBJPROP_PRICE,      _lvl);
   ObjectSetString (0, _pn, OBJPROP_TEXT,        _ptxt);
   ObjectSetInteger(0, _pn, OBJPROP_COLOR,       _col);
   ObjectSetInteger(0, _pn, OBJPROP_FONTSIZE,    8);
   ObjectSetInteger(0, _pn, OBJPROP_SELECTABLE,  false);
   if(${P}justConfirmed)
   {
      string _an = StringFormat("4B_EMA_${tf}_%d", (int)_bt);
      if(ObjectFind(0, _an) < 0)
      {
         ObjectCreate(0, _an, OBJ_ARROW, 0, _bt,
            ${P}confirmDir == 1 ? iLow(InpSymbol,${TF},1) : iHigh(InpSymbol,${TF},1));
         ObjectSetInteger(0, _an, OBJPROP_ARROWCODE,
            ${P}confirmDir == 1 ? 233 : 234);
         ObjectSetInteger(0, _an, OBJPROP_COLOR,
            ${P}confirmDir == 1 ? clrCornflowerBlue : clrSalmon);
         ObjectSetInteger(0, _an, OBJPROP_ANCHOR,
            ${P}confirmDir == 1 ? ANCHOR_TOP : ANCHOR_BOTTOM);
         ObjectSetInteger(0, _an, OBJPROP_WIDTH,      2);
         ObjectSetInteger(0, _an, OBJPROP_SELECTABLE, false);
      }
   }
}

bool   ${P}SetupActive()  { return ${P}phase == ${P}CROSSED || ${P}phase == ${P}ARMED; }
bool   ${P}RetestActive() { return ${P}phase == ${P}ARMED; }
int    ${P}ActiveDir()    { return ${P}activeDir; }
double ${P}ActiveSL()     { return (${P}activeDir == 1) ? ${P}swingLow : ${P}swingHigh; }
bool   ${P}JustConfirmed(){ return ${P}justConfirmed; }
int    ${P}ConfirmDir()   { return ${P}confirmDir; }
double ${P}ConfirmSL()    { return ${P}confirmSL; }
`;
}
