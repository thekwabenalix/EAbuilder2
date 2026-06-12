/**
 * Inline iFVG State Machine Generator
 *
 * Adapts the Phase 3 FVG_Inversion_State_Module directly into an EA.
 * No separate indicator file required — the state machine runs inside the EA.
 *
 * Lifecycle (matches Phase 3 exactly):
 *   FVG detected → FVG inverted → iFVG ACTIVE
 *   iFVG ACTIVE → price enters zone → iFVG RETESTED
 *   iFVG RETESTED → price closes outside → iFVG CONFIRMED  ← signal fires here
 *   Any live state → MITIGATED | INVALIDATED | EXPIRED
 *
 * Usage:
 *   genFvgInversionSM("H1", "PERIOD_H1", "H1", 100)
 *   → emits all structs, arrays, and functions prefixed with "IFVGSM_H1_"
 *   → call IFVGSM_H1_Tick(1) each bar-open to advance the machine
 *   → read IFVGSM_H1_BullConfirmed(), IFVGSM_H1_BullSL(), etc.
 */

export function genFvgInversionSM(
  id: string, // e.g. "H1" → all names get IFVGSM_H1_ prefix
  TF: string, // e.g. "PERIOD_H1"
  tf: string, // e.g. "H1" (for log messages)
  expiryBars = 100,
): string {
  const P = `IFVGSM_${id}_`; // prefix for all names in this instance

  return `
//+------------------------------------------------------------------+
//| iFVG State Machine — ${tf} (instance: ${id})                     |
//| Inlined from Phase 3 FVG_Inversion_State_Module                 |
//| Lifecycle: FVG → ACTIVE → RETESTED → CONFIRMED → terminal       |
//+------------------------------------------------------------------+

#define ${P}ACTIVE       0
#define ${P}RETESTED     1
#define ${P}CONFIRMED    2
#define ${P}MITIGATED    3
#define ${P}INVALIDATED  4
#define ${P}EXPIRED      5

struct ${P}FvgRec
{
   int      dir;        //  1=bullish gap  -1=bearish gap
   double   ul;         // upper limit of gap
   double   ll;         // lower limit of gap
   datetime c1Time;     // time of C1 (oldest candle of 3-candle group)
   bool     inverted;   // true once this FVG has been inverted → iFVG born
};

struct ${P}IfvgRec
{
   int      dir;            //  1=bull iFVG (support)  -1=bear iFVG (resistance)
   double   ul;
   double   ll;
   int      state;
   int      barsAlive;
   datetime fvgTime;        // original FVG birth time (chart rect left edge)
   datetime inversionTime;  // bar where FVG was first inverted
   bool     justInverted;   // true for ONE bar after the iFVG is born
   double   inversionSL;    // inversion bar low (bull) or high (bear)
   datetime retestTime;
   double   retestHigh;
   double   retestLow;
   datetime confirmTime;
   // Output: set when state → CONFIRMED
   bool     justConfirmed;  // true for ONE bar after confirmation
   bool     justRetested;   // true for ONE bar after first wick into zone
   double   confirmSL;      // retestLow (bull) or retestHigh (bear) at confirmation
};

#define ${P}MAX_FVGS  500
#define ${P}MAX_IFVGS 200

${P}FvgRec  ${P}fvgList[${P}MAX_FVGS];
int         ${P}fvgCount  = 0;

${P}IfvgRec ${P}ifvgList[${P}MAX_IFVGS];
int         ${P}ifvgCount = 0;
datetime    ${P}lastBar   = 0;

// ── Reset (call on OnInit or full recalc) ──────────────────────────────────
void ${P}Reset()
{
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
   {
      string _rn = StringFormat("4B_IFVG_${tf}_%d", (int)${P}ifvgList[_i].inversionTime);
      ObjectDelete(0, _rn);
      ObjectDelete(0, _rn + "_L");
   }
   ${P}fvgCount  = 0;
   ${P}ifvgCount = 0;
   ${P}lastBar   = 0;
}

// ── Detect 3-candle FVG at bar shift sh (C3=sh, C2=sh+1, C1=sh+2) ─────────
void ${P}DetectFvg(int sh)
{
   int totalBars = iBars(InpSymbol, ${TF});
   if(sh + 2 >= totalBars) return;

   datetime c1T = iTime(InpSymbol, ${TF}, sh + 2);

   // Dedup: skip if we already have a non-inverted FVG from this C1 bar
   for(int _k = 0; _k < ${P}fvgCount; _k++)
   {
      if(!${P}fvgList[_k].inverted && ${P}fvgList[_k].c1Time == c1T) return;
   }

   double c3Lo = iLow (InpSymbol, ${TF}, sh);
   double c1Hi = iHigh(InpSymbol, ${TF}, sh + 2);
   double c3Hi = iHigh(InpSymbol, ${TF}, sh);
   double c1Lo = iLow (InpSymbol, ${TF}, sh + 2);

   bool isBullGap = (c3Lo > c1Hi);
   bool isBearGap = (c3Hi < c1Lo);
   if(!isBullGap && !isBearGap) return;

   // Slot: recycle an inverted slot before growing
   int idx = -1;
   for(int _k = 0; _k < ${P}fvgCount; _k++)
      if(${P}fvgList[_k].inverted) { idx = _k; break; }
   if(idx < 0)
   {
      if(${P}fvgCount >= ${P}MAX_FVGS) return;
      idx = ${P}fvgCount++;
   }

   ${P}fvgList[idx].dir      = isBullGap ? 1 : -1;
   ${P}fvgList[idx].ul       = isBullGap ? c3Lo : c1Lo;  // Bull: C3.Low  Bear: C1.Low
   ${P}fvgList[idx].ll       = isBullGap ? c1Hi : c3Hi;  // Bull: C1.High Bear: C3.High
   ${P}fvgList[idx].c1Time   = c1T;
   ${P}fvgList[idx].inverted = false;
}

// ── Check if bar sh inverts any non-inverted FVG → birth of iFVG ──────────
void ${P}CheckInversion(int sh)
{
   double   closeV = iClose(InpSymbol, ${TF}, sh);
   double   barHi  = iHigh (InpSymbol, ${TF}, sh);
   double   barLo  = iLow  (InpSymbol, ${TF}, sh);
   datetime barT   = iTime (InpSymbol, ${TF}, sh);

   for(int _k = 0; _k < ${P}fvgCount; _k++)
   {
      if(${P}fvgList[_k].inverted)         continue;
      if(${P}fvgList[_k].c1Time >= barT)   continue;  // FVG must pre-date this bar

      //  Bull FVG (UL=C3.Low, LL=C1.High): inverted when close < LL → Bear iFVG
      //  Bear FVG (UL=C1.Low, LL=C3.High): inverted when close > UL → Bull iFVG
      bool doInvert = (${P}fvgList[_k].dir ==  1 && closeV < ${P}fvgList[_k].ll)
                   || (${P}fvgList[_k].dir == -1 && closeV > ${P}fvgList[_k].ul);
      if(!doInvert) continue;

      // Slot: recycle terminal iFVG slot
      int iIdx = -1;
      for(int _m = 0; _m < ${P}ifvgCount; _m++)
      {
         int _ist = ${P}ifvgList[_m].state;
         if(_ist == ${P}MITIGATED || _ist == ${P}INVALIDATED || _ist == ${P}EXPIRED)
            { iIdx = _m; break; }
      }
      if(iIdx < 0)
      {
         if(${P}ifvgCount >= ${P}MAX_IFVGS) { ${P}fvgList[_k].inverted = true; continue; }
         iIdx = ${P}ifvgCount++;
      }

      // iFVG direction is OPPOSITE to the original FVG
      ${P}ifvgList[iIdx].dir           = (${P}fvgList[_k].dir == 1) ? -1 : 1;
      ${P}ifvgList[iIdx].ul            = ${P}fvgList[_k].ul;
      ${P}ifvgList[iIdx].ll            = ${P}fvgList[_k].ll;
      ${P}ifvgList[iIdx].state         = ${P}ACTIVE;
      ${P}ifvgList[iIdx].barsAlive     = 0;
      ${P}ifvgList[iIdx].fvgTime       = ${P}fvgList[_k].c1Time;
      ${P}ifvgList[iIdx].inversionTime = barT;
      ${P}ifvgList[iIdx].justInverted  = true;
      ${P}ifvgList[iIdx].inversionSL   = (${P}fvgList[_k].dir == -1) ? barLo : barHi;
      ${P}ifvgList[iIdx].retestTime    = 0;
      ${P}ifvgList[iIdx].retestHigh    = 0.0;
      ${P}ifvgList[iIdx].retestLow     = 1e10;
      ${P}ifvgList[iIdx].confirmTime   = 0;
      ${P}ifvgList[iIdx].justConfirmed = false;
      ${P}ifvgList[iIdx].justRetested = false;
      ${P}ifvgList[iIdx].confirmSL     = 0.0;

      ${P}fvgList[_k].inverted = true;

      PrintFormat("[IFVGSM/${tf}] %s ACTIVE | ul=%.5f ll=%.5f | inv=%s",
                  ${P}ifvgList[iIdx].dir>0?"BULL":"BEAR",
                  ${P}ifvgList[iIdx].ul, ${P}ifvgList[iIdx].ll,
                  TimeToString(barT, TIME_DATE|TIME_MINUTES));
   }
}

// ── Advance all live iFVG states for bar sh ───────────────────────────────
void ${P}UpdateStates(int sh)
{
   double   barHi  = iHigh (InpSymbol, ${TF}, sh);
   double   barLo  = iLow  (InpSymbol, ${TF}, sh);
   double   barCl  = iClose(InpSymbol, ${TF}, sh);
   datetime barT   = iTime (InpSymbol, ${TF}, sh);

   for(int _i = 0; _i < ${P}ifvgCount; _i++)
   {
      int _st = ${P}ifvgList[_i].state;
      if(_st == ${P}MITIGATED || _st == ${P}INVALIDATED || _st == ${P}EXPIRED) continue;
      if(${P}ifvgList[_i].inversionTime >= barT) continue;  // skip inversion bar

      ${P}ifvgList[_i].barsAlive++;
      ${P}ifvgList[_i].justConfirmed = false;  // reset per bar
      ${P}ifvgList[_i].justRetested = false;

      bool   isBull = (${P}ifvgList[_i].dir == 1);
      double ul     = ${P}ifvgList[_i].ul;
      double ll     = ${P}ifvgList[_i].ll;

      // Expiry
      if(${P}ifvgList[_i].barsAlive >= ${expiryBars})
      {
         ${P}ifvgList[_i].state = ${P}EXPIRED;
         PrintFormat("[IFVGSM/${tf}] %s EXPIRED", isBull?"BULL":"BEAR");
         continue;
      }

      if(isBull)
      {
         // Invalidated: close below LL
         if(barCl < ll) { ${P}ifvgList[_i].state = ${P}INVALIDATED; continue; }
         // Mitigated: close inside zone
         if(barCl >= ll && barCl <= ul) { ${P}ifvgList[_i].state = ${P}MITIGATED; continue; }
         // CONFIRMED: from RETESTED, close above UL
         if(_st == ${P}RETESTED && barCl > ul)
         {
            ${P}ifvgList[_i].state         = ${P}CONFIRMED;
            ${P}ifvgList[_i].confirmTime   = barT;
            ${P}ifvgList[_i].justConfirmed = true;
            ${P}ifvgList[_i].confirmSL     = ${P}ifvgList[_i].retestLow;
            PrintFormat("[IFVGSM/${tf}] BULL CONFIRMED | ul=%.5f ll=%.5f | retestLow=%.5f | %s",
                        ul, ll, ${P}ifvgList[_i].retestLow,
                        TimeToString(barT, TIME_DATE|TIME_MINUTES));
            continue;
         }
         // RETESTED: wick enters zone from above
         if(barLo <= ul)
         {
            if(_st != ${P}RETESTED)
            {
               ${P}ifvgList[_i].state     = ${P}RETESTED;
               ${P}ifvgList[_i].retestTime= barT;
               ${P}ifvgList[_i].retestLow = barLo;
               ${P}ifvgList[_i].retestHigh= barHi;
               ${P}ifvgList[_i].justRetested = true;
               PrintFormat("[IFVGSM/${tf}] BULL RETESTED | ul=%.5f retestLow=%.5f", ul, barLo);
            }
            else
            {
               if(barLo  < ${P}ifvgList[_i].retestLow)  ${P}ifvgList[_i].retestLow  = barLo;
               if(barHi > ${P}ifvgList[_i].retestHigh) ${P}ifvgList[_i].retestHigh = barHi;
            }
         }
      }
      else // bear iFVG
      {
         // Invalidated: close above UL
         if(barCl > ul) { ${P}ifvgList[_i].state = ${P}INVALIDATED; continue; }
         // Mitigated: close inside zone
         if(barCl >= ll && barCl <= ul) { ${P}ifvgList[_i].state = ${P}MITIGATED; continue; }
         // CONFIRMED: from RETESTED, close below LL
         if(_st == ${P}RETESTED && barCl < ll)
         {
            ${P}ifvgList[_i].state         = ${P}CONFIRMED;
            ${P}ifvgList[_i].confirmTime   = barT;
            ${P}ifvgList[_i].justConfirmed = true;
            ${P}ifvgList[_i].confirmSL     = ${P}ifvgList[_i].retestHigh;
            PrintFormat("[IFVGSM/${tf}] BEAR CONFIRMED | ul=%.5f ll=%.5f | retestHigh=%.5f | %s",
                        ul, ll, ${P}ifvgList[_i].retestHigh,
                        TimeToString(barT, TIME_DATE|TIME_MINUTES));
            continue;
         }
         // RETESTED: wick enters zone from below
         if(barHi >= ll)
         {
            if(_st != ${P}RETESTED)
            {
               ${P}ifvgList[_i].state      = ${P}RETESTED;
               ${P}ifvgList[_i].retestTime = barT;
               ${P}ifvgList[_i].retestLow  = barLo;
               ${P}ifvgList[_i].retestHigh = barHi;
               ${P}ifvgList[_i].justRetested = true;
               PrintFormat("[IFVGSM/${tf}] BEAR RETESTED | ll=%.5f retestHigh=%.5f", ll, barHi);
            }
            else
            {
               if(barLo  < ${P}ifvgList[_i].retestLow)  ${P}ifvgList[_i].retestLow  = barLo;
               if(barHi > ${P}ifvgList[_i].retestHigh) ${P}ifvgList[_i].retestHigh = barHi;
            }
         }
      }
   }
   // ── Chart visualization ──────────────────────────────────────────
   datetime _t2 = iTime(InpSymbol, PERIOD_CURRENT, 0) + PeriodSeconds(${TF}) * 5;
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
   {
      string _rn = StringFormat("4B_IFVG_${tf}_%d", (int)${P}ifvgList[_i].inversionTime);
      string _ln = _rn + "_L";
      int _st = ${P}ifvgList[_i].state;
      if(_st == ${P}MITIGATED || _st == ${P}INVALIDATED || _st == ${P}EXPIRED)
      {
         ObjectDelete(0, _rn);
         ObjectDelete(0, _ln);
         continue;
      }
      color _col = _st == ${P}RETESTED  ? clrGold
                 : _st == ${P}CONFIRMED  ? clrDimGray
                 : ${P}ifvgList[_i].dir == 1 ? clrDodgerBlue
                 :                             clrOrangeRed;
      if(ObjectFind(0, _rn) < 0)
         ObjectCreate(0, _rn, OBJ_RECTANGLE, 0, ${P}ifvgList[_i].inversionTime, ${P}ifvgList[_i].ul, _t2, ${P}ifvgList[_i].ll);
      ObjectSetInteger(0, _rn, OBJPROP_TIME,       1, _t2);
      ObjectSetInteger(0, _rn, OBJPROP_COLOR,         _col);
      ObjectSetInteger(0, _rn, OBJPROP_STYLE,         STYLE_SOLID);
      ObjectSetInteger(0, _rn, OBJPROP_WIDTH,         1);
      ObjectSetInteger(0, _rn, OBJPROP_BACK,          true);
      ObjectSetInteger(0, _rn, OBJPROP_FILL,          true);
      ObjectSetInteger(0, _rn, OBJPROP_SELECTABLE,    false);
      string _stxt = _st == ${P}RETESTED  ? (${P}ifvgList[_i].dir==1 ? "iFVG-T+" : "iFVG-T-")
                   : _st == ${P}CONFIRMED  ? (${P}ifvgList[_i].dir==1 ? "iFVG-C+" : "iFVG-C-")
                   :                         (${P}ifvgList[_i].dir==1 ? "iFVG+"   : "iFVG-");
      double _mid = (${P}ifvgList[_i].ul + ${P}ifvgList[_i].ll) * 0.5;
      if(ObjectFind(0, _ln) < 0)
         ObjectCreate(0, _ln, OBJ_TEXT, 0, ${P}ifvgList[_i].inversionTime, _mid);
      ObjectSetString (0, _ln, OBJPROP_TEXT,        _stxt);
      ObjectSetInteger(0, _ln, OBJPROP_COLOR,       _col);
      ObjectSetInteger(0, _ln, OBJPROP_FONTSIZE,    7);
      ObjectSetInteger(0, _ln, OBJPROP_SELECTABLE,  false);
   }
}

// ── Main tick function: call once per bar at bar-open (sh=1) ──────────────
void ${P}Tick(int sh)
{
   datetime _bt = iTime(InpSymbol, ${TF}, 0);
   if(_bt == ${P}lastBar) return;
   ${P}lastBar = _bt;
   for(int _i = 0; _i < ${P}ifvgCount; _i++) ${P}ifvgList[_i].justInverted = false;
   ${P}DetectFvg(sh);
   ${P}CheckInversion(sh);
   ${P}UpdateStates(sh);
}

// ── Accessors ─────────────────────────────────────────────────────────────

// True if a bull iFVG was BORN this bar (bearish FVG closed above UL)
bool ${P}BullJustInverted()
{
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].justInverted) return true;
   return false;
}
// True if a bear iFVG was BORN this bar (bullish FVG closed below LL)
bool ${P}BearJustInverted()
{
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].justInverted) return true;
   return false;
}
double ${P}BullInversionSL()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].justInverted)
         return ${P}ifvgList[_i].inversionSL;
   return 0.0;
}
double ${P}BearInversionSL()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].justInverted)
         return ${P}ifvgList[_i].inversionSL;
   return 0.0;
}
datetime ${P}BullInversionTime()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].justInverted)
         return ${P}ifvgList[_i].inversionTime;
   return 0;
}
datetime ${P}BearInversionTime()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].justInverted)
         return ${P}ifvgList[_i].inversionTime;
   return 0;
}
// True if a bull iFVG was CONFIRMED this bar (justConfirmed flag)
bool ${P}BullJustConfirmed()
{
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].justConfirmed) return true;
   return false;
}
// True if a bear iFVG was CONFIRMED this bar
bool ${P}BearJustConfirmed()
{
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].justConfirmed) return true;
   return false;
}
bool ${P}BullJustRetested()
{
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].justRetested) return true;
   return false;
}
bool ${P}BearJustRetested()
{
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].justRetested) return true;
   return false;
}
// SL level for the most recently confirmed bull iFVG
double ${P}BullConfirmSL()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].justConfirmed)
         return ${P}ifvgList[_i].confirmSL;
   return 0.0;
}
double ${P}BearConfirmSL()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].justConfirmed)
         return ${P}ifvgList[_i].confirmSL;
   return 0.0;
}
// True if ANY live (non-terminal) bull/bear iFVG exists in the given direction
bool ${P}HasActiveBull()
{
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
   {
      int _st = ${P}ifvgList[_i].state;
      if(${P}ifvgList[_i].dir == 1 && _st != ${P}MITIGATED && _st != ${P}INVALIDATED && _st != ${P}EXPIRED)
         return true;
   }
   return false;
}
bool ${P}HasActiveBear()
{
   for(int _i = 0; _i < ${P}ifvgCount; _i++)
   {
      int _st = ${P}ifvgList[_i].state;
      if(${P}ifvgList[_i].dir == -1 && _st != ${P}MITIGATED && _st != ${P}INVALIDATED && _st != ${P}EXPIRED)
         return true;
   }
   return false;
}
// Zone bounds of the most recently ACTIVE bull iFVG (for chart drawing)
double ${P}LatestBullUL()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].state <= ${P}CONFIRMED)
         return ${P}ifvgList[_i].ul;
   return 0.0;
}
double ${P}LatestBullLL()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].state <= ${P}CONFIRMED)
         return ${P}ifvgList[_i].ll;
   return 0.0;
}
double ${P}LatestBearUL()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].state <= ${P}CONFIRMED)
         return ${P}ifvgList[_i].ul;
   return 0.0;
}
double ${P}LatestBearLL()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].state <= ${P}CONFIRMED)
         return ${P}ifvgList[_i].ll;
   return 0.0;
}
datetime ${P}LatestBullFvgTime()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].state <= ${P}CONFIRMED)
         return ${P}ifvgList[_i].fvgTime;
   return 0;
}
datetime ${P}LatestBearFvgTime()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].state <= ${P}CONFIRMED)
         return ${P}ifvgList[_i].fvgTime;
   return 0;
}
datetime ${P}LatestBullInversionTime()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].state <= ${P}CONFIRMED)
         return ${P}ifvgList[_i].inversionTime;
   return 0;
}
datetime ${P}LatestBearInversionTime()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].state <= ${P}CONFIRMED)
         return ${P}ifvgList[_i].inversionTime;
   return 0;
}
datetime ${P}BullConfirmTime()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == 1 && ${P}ifvgList[_i].justConfirmed)
         return ${P}ifvgList[_i].confirmTime;
   return 0;
}
datetime ${P}BearConfirmTime()
{
   for(int _i = ${P}ifvgCount - 1; _i >= 0; _i--)
      if(${P}ifvgList[_i].dir == -1 && ${P}ifvgList[_i].justConfirmed)
         return ${P}ifvgList[_i].confirmTime;
   return 0;
}
`;
}
