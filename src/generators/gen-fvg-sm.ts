/**
 * Inline FVG State Machine Generator
 *
 * Embeds FVG detection + full lifecycle state machine directly in an EA.
 * No external indicator required — zero dependencies.
 *
 * States: ACTIVE → RETESTED → CONFIRMED (consumed) | MITIGATED | INVALIDATED | EXPIRED
 *
 * Standard API:
 *   FVGSM_{id}_Reset()
 *   FVGSM_{id}_Tick(lookback)         — call once per bar-open
 *   FVGSM_{id}_BullJustConfirmed()    — true for ONE bar after bull confirmation
 *   FVGSM_{id}_BearJustConfirmed()    — true for ONE bar after bear confirmation
 *   FVGSM_{id}_BullConfirmSL()        — retestLow at last bull confirmation
 *   FVGSM_{id}_BearConfirmSL()        — retestHigh at last bear confirmation
 *   FVGSM_{id}_HasActiveBull()        — any live bull FVG (ACTIVE or RETESTED)
 *   FVGSM_{id}_HasActiveBear()        — any live bear FVG
 */

export function genFvgSM(
  id: string, // e.g. "H4"  → prefix FVGSM_H4_
  TF: string, // e.g. "PERIOD_H4"
  tf: string, // e.g. "H4"  (log messages)
  expiryBars = 100,
): string {
  const P = `FVGSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| FVG State Machine — ${tf} (${id})                               |
//| States: ACTIVE → RETESTED → CONFIRMED | MITIGATED/INVALID/EXPIRED|
//+------------------------------------------------------------------+
#define ${P}ACTIVE       0
#define ${P}RETESTED     1
#define ${P}CONFIRMED    2
#define ${P}MITIGATED    3
#define ${P}INVALIDATED  4
#define ${P}EXPIRED      5

struct ${P}FvgRec
{
   int      dir;        //  1=bull  -1=bear
   double   ul;         // upper limit
   double   ll;         // lower limit
   datetime leftTime;   // C1 time (oldest candle of gap)
   int      state;
   int      barsAlive;
   double   retestHigh;
   double   retestLow;
   bool     justConfirmed;
   double   confirmSL;  // retestLow (bull) or retestHigh (bear)
};

#define ${P}MAX_ZONES 200
${P}FvgRec  ${P}zones[${P}MAX_ZONES];
int         ${P}zoneCount = 0;
bool        ${P}_bullConfirmed = false;
bool        ${P}_bearConfirmed = false;
bool        ${P}_bullJustRetested = false;
bool        ${P}_bearJustRetested = false;
double      ${P}_bullSL = 0.0;
double      ${P}_bearSL = 0.0;

void ${P}Reset()
{
   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      string _rn = StringFormat("4B_FVG_${tf}_%d", (int)${P}zones[_k].leftTime);
      ObjectDelete(0, _rn);
      ObjectDelete(0, _rn + "_L");
   }
   ${P}zoneCount      = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullJustRetested = false;
   ${P}_bearJustRetested = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

// ── Detect 3-candle FVG at bar shift sh ─────────────────────────────
void ${P}Detect(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + 2 >= total) return;
   datetime leftT = iTime(InpSymbol, ${TF}, sh + 2);
   // dedup
   for(int _k = 0; _k < ${P}zoneCount; _k++)
      if(${P}zones[_k].state <= ${P}CONFIRMED && ${P}zones[_k].leftTime == leftT) return;

   double c3Lo = iLow (InpSymbol, ${TF}, sh);
   double c1Hi = iHigh(InpSymbol, ${TF}, sh + 2);
   double c3Hi = iHigh(InpSymbol, ${TF}, sh);
   double c1Lo = iLow (InpSymbol, ${TF}, sh + 2);
   bool bull = (c3Lo > c1Hi);
   bool bear = (c3Hi < c1Lo);
   if(!bull && !bear) return;

   // find slot
   int idx = -1;
   for(int _k = 0; _k < ${P}zoneCount; _k++)
      if(${P}zones[_k].state >= ${P}MITIGATED) { idx = _k; break; }
   if(idx < 0) {
      if(${P}zoneCount >= ${P}MAX_ZONES) return;
      idx = ${P}zoneCount++;
   }
   ${P}zones[idx].dir           = bull ? 1 : -1;
   ${P}zones[idx].ul            = bull ? c3Lo : c1Lo;
   ${P}zones[idx].ll            = bull ? c1Hi : c3Hi;
   ${P}zones[idx].leftTime      = leftT;
   ${P}zones[idx].state         = ${P}ACTIVE;
   ${P}zones[idx].barsAlive     = 0;
   ${P}zones[idx].retestHigh    = 0;
   ${P}zones[idx].retestLow     = 1e10;
   ${P}zones[idx].justConfirmed = false;
   ${P}zones[idx].confirmSL     = 0;
}

// ── Advance state machine for one bar ───────────────────────────────
void ${P}Advance(int sh)
{
   double lo = iLow  (InpSymbol, ${TF}, sh);
   double hi = iHigh (InpSymbol, ${TF}, sh);
   double cl = iClose(InpSymbol, ${TF}, sh);
   ${P}_bullJustRetested = false;
   ${P}_bearJustRetested = false;

   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      if(${P}zones[_k].state >= ${P}MITIGATED) continue;

      ${P}zones[_k].barsAlive++;
      ${P}zones[_k].justConfirmed = false;

      // Expiry
      if(${P}zones[_k].barsAlive >= ${expiryBars}) { ${P}zones[_k].state = ${P}EXPIRED; continue; }

      if(${P}zones[_k].dir == 1)  // ── BULL FVG ─────────────────────────────────
      {
         // MITIGATED: close inside zone
         if(cl >= ${P}zones[_k].ll && cl <= ${P}zones[_k].ul) { ${P}zones[_k].state = ${P}MITIGATED; continue; }
         // INVALIDATED: close below far edge
         if(cl < ${P}zones[_k].ll) { ${P}zones[_k].state = ${P}INVALIDATED; continue; }
         // RETESTED: wick enters zone from above
         if(${P}zones[_k].state == ${P}ACTIVE && lo <= ${P}zones[_k].ul)
         {
            ${P}zones[_k].state = ${P}RETESTED;
            ${P}zones[_k].retestLow = lo;
            ${P}_bullJustRetested = true;
         }
         if(${P}zones[_k].state == ${P}RETESTED)
         {
            if(lo < ${P}zones[_k].retestLow) ${P}zones[_k].retestLow = lo;   // track worst wick
            // CONFIRMED: close back above UL
            if(cl > ${P}zones[_k].ul) {
               ${P}zones[_k].state = ${P}CONFIRMED;
               ${P}zones[_k].justConfirmed = true;
               ${P}zones[_k].confirmSL = ${P}zones[_k].retestLow;
               ${P}_bullConfirmed = true;
               ${P}_bullSL = ${P}zones[_k].retestLow;
               PrintFormat("[FVGSM_${tf}] BULL CONFIRMED UL=%.5f SL=%.5f", ${P}zones[_k].ul, ${P}zones[_k].retestLow);
            }
         }
      }
      else  // ── BEAR FVG ─────────────────────────────────────────
      {
         if(cl >= ${P}zones[_k].ll && cl <= ${P}zones[_k].ul) { ${P}zones[_k].state = ${P}MITIGATED; continue; }
         if(cl > ${P}zones[_k].ul) { ${P}zones[_k].state = ${P}INVALIDATED; continue; }
         if(${P}zones[_k].state == ${P}ACTIVE && hi >= ${P}zones[_k].ll)
         {
            ${P}zones[_k].state = ${P}RETESTED;
            ${P}zones[_k].retestHigh = hi;
            ${P}_bearJustRetested = true;
         }
         if(${P}zones[_k].state == ${P}RETESTED)
         {
            if(hi > ${P}zones[_k].retestHigh) ${P}zones[_k].retestHigh = hi;
            if(cl < ${P}zones[_k].ll) {
               ${P}zones[_k].state = ${P}CONFIRMED;
               ${P}zones[_k].justConfirmed = true;
               ${P}zones[_k].confirmSL = ${P}zones[_k].retestHigh;
               ${P}_bearConfirmed = true;
               ${P}_bearSL = ${P}zones[_k].retestHigh;
               PrintFormat("[FVGSM_${tf}] BEAR CONFIRMED LL=%.5f SL=%.5f", ${P}zones[_k].ll, ${P}zones[_k].retestHigh);
            }
         }
      }
   }
   // ── Chart visualization ──────────────────────────────────────────
   datetime _t2 = iTime(InpSymbol, PERIOD_CURRENT, 0) + PeriodSeconds(${TF}) * 5;
   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      string _rn = StringFormat("4B_FVG_${tf}_%d", (int)${P}zones[_k].leftTime);
      string _ln = _rn + "_L";
      if(${P}zones[_k].state >= ${P}MITIGATED)
      {
         ObjectDelete(0, _rn);
         ObjectDelete(0, _ln);
         continue;
      }
      color _col = ${P}zones[_k].state == ${P}RETESTED  ? clrGold
                 : ${P}zones[_k].state == ${P}CONFIRMED  ? clrDimGray
                 : ${P}zones[_k].dir == 1                ? clrCornflowerBlue
                 :                                         clrSalmon;
      if(ObjectFind(0, _rn) < 0)
         ObjectCreate(0, _rn, OBJ_RECTANGLE, 0, ${P}zones[_k].leftTime, ${P}zones[_k].ul, _t2, ${P}zones[_k].ll);
      ObjectSetInteger(0, _rn, OBJPROP_TIME,       1, _t2);
      ObjectSetInteger(0, _rn, OBJPROP_COLOR,         _col);
      ObjectSetInteger(0, _rn, OBJPROP_STYLE,         STYLE_SOLID);
      ObjectSetInteger(0, _rn, OBJPROP_WIDTH,         1);
      ObjectSetInteger(0, _rn, OBJPROP_BACK,          true);
      ObjectSetInteger(0, _rn, OBJPROP_FILL,          true);
      ObjectSetInteger(0, _rn, OBJPROP_SELECTABLE,    false);
      string _stxt = ${P}zones[_k].state == ${P}RETESTED  ? (${P}zones[_k].dir==1 ? "FVG-T+" : "FVG-T-")
                   : ${P}zones[_k].state == ${P}CONFIRMED  ? (${P}zones[_k].dir==1 ? "FVG-C+" : "FVG-C-")
                   :                                          (${P}zones[_k].dir==1 ? "FVG+"   : "FVG-");
      double _mid = (${P}zones[_k].ul + ${P}zones[_k].ll) * 0.5;
      if(ObjectFind(0, _ln) < 0)
         ObjectCreate(0, _ln, OBJ_TEXT, 0, ${P}zones[_k].leftTime, _mid);
      ObjectSetString (0, _ln, OBJPROP_TEXT,        _stxt);
      ObjectSetInteger(0, _ln, OBJPROP_COLOR,       _col);
      ObjectSetInteger(0, _ln, OBJPROP_FONTSIZE,    7);
      ObjectSetInteger(0, _ln, OBJPROP_SELECTABLE,  false);
   }
}

void ${P}Tick(int lookback)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullJustRetested = false;
   ${P}_bearJustRetested = false;
   for(int sh = lookback; sh >= 1; sh--) ${P}Detect(sh);
   ${P}Advance(1);
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
bool   ${P}BullJustRetested()  { return ${P}_bullJustRetested; }
bool   ${P}BearJustRetested()  { return ${P}_bearJustRetested; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }
bool   ${P}HasActiveBull()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==1 && ${P}zones[_k].state<=2) return true;
   return false;
}
bool   ${P}HasActiveBear()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==-1 && ${P}zones[_k].state<=2) return true;
   return false;
}
`;
}
