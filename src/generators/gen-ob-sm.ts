/**
 * Inline Order Block State Machine Generator
 *
 * Detects OB zones (last opposing candle before ATR-displacement) and
 * tracks them through ACTIVE → RETESTED → CONFIRMED lifecycle.
 *
 * Standard API:
 *   OBSM_{id}_Reset()
 *   OBSM_{id}_Tick(lookback)
 *   OBSM_{id}_BullJustConfirmed()   — bull OB confirmed this bar
 *   OBSM_{id}_BearJustConfirmed()   — bear OB confirmed this bar
 *   OBSM_{id}_BullConfirmSL()       — retestLow at last bull confirmation
 *   OBSM_{id}_BearConfirmSL()       — retestHigh at last bear confirmation
 *   OBSM_{id}_HasActiveBull()       — any live bull OB
 *   OBSM_{id}_HasActiveBear()       — any live bear OB
 *   OBSM_{id}_LatestBullLL()        — lower limit of most recent bull OB
 *   OBSM_{id}_LatestBearUL()        — upper limit of most recent bear OB
 */

export function genObSM(
  id: string,
  TF: string,
  tf: string,
  dispMult = 0.6, // body must be >= dispMult * candle range
  scanBack = 5, // bars before displacement to look for OB candle
  expiryBars = 100,
): string {
  const P = `OBSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| OB State Machine — ${tf} (${id})                               |
//| States: ACTIVE → RETESTED → CONFIRMED | MITIGATED/INVALID/EXPIRED|
//+------------------------------------------------------------------+
#define ${P}ACTIVE       0
#define ${P}RETESTED     1
#define ${P}CONFIRMED    2
#define ${P}MITIGATED    3
#define ${P}INVALIDATED  4
#define ${P}EXPIRED      5

struct ${P}OBRec
{
   int      dir;         //  1=bull  -1=bear
   double   hi;          // OB candle high
   double   lo;          // OB candle low
   datetime obTime;
   int      state;
   int      barsAlive;
   double   retestHigh;
   double   retestLow;
   bool     justConfirmed;
   double   confirmSL;
};

#define ${P}MAX_OBS 100
${P}OBRec ${P}zones[${P}MAX_OBS];
int       ${P}zoneCount     = 0;
bool      ${P}_bullConfirmed = false;
bool      ${P}_bearConfirmed = false;
bool      ${P}_bullJustRetested = false;
bool      ${P}_bearJustRetested = false;
double    ${P}_bullSL = 0.0;
double    ${P}_bearSL = 0.0;

void ${P}Reset()
{
   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      string _rn = StringFormat("4B_OB_${tf}_%d", (int)${P}zones[_k].obTime);
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

// ── Detect OB: displacement at sh, search back for last opposing candle ───
void ${P}Detect(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh >= total) return;

   double dO = iOpen (InpSymbol, ${TF}, sh);
   double dC = iClose(InpSymbol, ${TF}, sh);
   double dH = iHigh (InpSymbol, ${TF}, sh);
   double dL = iLow  (InpSymbol, ${TF}, sh);
   double body  = MathAbs(dC - dO);
   double range = dH - dL;
   if(range <= 0 || body < range * ${dispMult}) return;
   int dispDir = (dC > dO) ? 1 : -1;

   // Find last opposing candle before displacement
   for(int _j = sh + 1; _j <= sh + ${scanBack} && _j < total; _j++)
   {
      double obO = iOpen (InpSymbol, ${TF}, _j);
      double obC = iClose(InpSymbol, ${TF}, _j);
      double obH = iHigh (InpSymbol, ${TF}, _j);
      double obL = iLow  (InpSymbol, ${TF}, _j);
      bool isOpposing = (dispDir ==  1 && obC < obO) || (dispDir == -1 && obC > obO);
      if(!isOpposing) continue;

      // Dedup
      datetime obT = iTime(InpSymbol, ${TF}, _j);
      bool exists = false;
      for(int _k = 0; _k < ${P}zoneCount; _k++)
         if(${P}zones[_k].obTime == obT) { exists = true; break; }
      if(exists) break;

      // Add OB
      int idx = -1;
      for(int _k = 0; _k < ${P}zoneCount; _k++)
         if(${P}zones[_k].state >= ${P}MITIGATED) { idx = _k; break; }
      if(idx < 0) {
         if(${P}zoneCount >= ${P}MAX_OBS) break;
         idx = ${P}zoneCount++;
      }
      ${P}zones[idx].dir           = dispDir;
      ${P}zones[idx].hi            = obH;
      ${P}zones[idx].lo            = obL;
      ${P}zones[idx].obTime        = obT;
      ${P}zones[idx].state         = ${P}ACTIVE;
      ${P}zones[idx].barsAlive     = 0;
      ${P}zones[idx].retestHigh    = 0;
      ${P}zones[idx].retestLow     = 1e10;
      ${P}zones[idx].justConfirmed = false;
      ${P}zones[idx].confirmSL     = 0;
      break;
   }
}

// ── Advance state machine ────────────────────────────────────────────
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

      if(${P}zones[_k].barsAlive >= ${expiryBars}) { ${P}zones[_k].state = ${P}EXPIRED; continue; }

      if(${P}zones[_k].dir == 1)  // ── BULL OB ─────────────────────────────────
      {
         if(cl < ${P}zones[_k].lo)  { ${P}zones[_k].state = ${P}INVALIDATED; continue; }
         if(cl >= ${P}zones[_k].lo && cl <= ${P}zones[_k].hi) { ${P}zones[_k].state = ${P}MITIGATED; continue; }
         if(${P}zones[_k].state == ${P}ACTIVE && lo <= ${P}zones[_k].hi)
         {
            ${P}zones[_k].state = ${P}RETESTED;
            ${P}zones[_k].retestLow = lo;
            ${P}_bullJustRetested = true;
         }
         if(${P}zones[_k].state == ${P}RETESTED)
         {
            if(lo < ${P}zones[_k].retestLow) ${P}zones[_k].retestLow = lo;
            if(cl > ${P}zones[_k].hi) {
               ${P}zones[_k].state = ${P}CONFIRMED;
               ${P}zones[_k].justConfirmed = true;
               ${P}zones[_k].confirmSL = ${P}zones[_k].retestLow;
               ${P}_bullConfirmed = true;
               ${P}_bullSL = ${P}zones[_k].retestLow;
               PrintFormat("[OBSM_${tf}] BULL CONFIRMED hi=%.5f SL=%.5f", ${P}zones[_k].hi, ${P}zones[_k].retestLow);
            }
         }
         if(${P}zones[_k].state == ${P}CONFIRMED && lo <= ${P}zones[_k].hi)
         { ${P}zones[_k].state = ${P}RETESTED; ${P}zones[_k].retestLow = lo; }
      }
      else  // ── BEAR OB ─────────────────────────────────────────
      {
         if(cl > ${P}zones[_k].hi)  { ${P}zones[_k].state = ${P}INVALIDATED; continue; }
         if(cl >= ${P}zones[_k].lo && cl <= ${P}zones[_k].hi) { ${P}zones[_k].state = ${P}MITIGATED; continue; }
         if(${P}zones[_k].state == ${P}ACTIVE && hi >= ${P}zones[_k].lo)
         {
            ${P}zones[_k].state = ${P}RETESTED;
            ${P}zones[_k].retestHigh = hi;
            ${P}_bearJustRetested = true;
         }
         if(${P}zones[_k].state == ${P}RETESTED)
         {
            if(hi > ${P}zones[_k].retestHigh) ${P}zones[_k].retestHigh = hi;
            if(cl < ${P}zones[_k].lo) {
               ${P}zones[_k].state = ${P}CONFIRMED;
               ${P}zones[_k].justConfirmed = true;
               ${P}zones[_k].confirmSL = ${P}zones[_k].retestHigh;
               ${P}_bearConfirmed = true;
               ${P}_bearSL = ${P}zones[_k].retestHigh;
               PrintFormat("[OBSM_${tf}] BEAR CONFIRMED lo=%.5f SL=%.5f", ${P}zones[_k].lo, ${P}zones[_k].retestHigh);
            }
         }
         if(${P}zones[_k].state == ${P}CONFIRMED && hi >= ${P}zones[_k].lo)
         { ${P}zones[_k].state = ${P}RETESTED; ${P}zones[_k].retestHigh = hi; }
      }
   }
   // ── Chart visualization ──────────────────────────────────────────
   datetime _t2 = iTime(InpSymbol, PERIOD_CURRENT, 0) + PeriodSeconds(${TF}) * 5;
   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      string _rn = StringFormat("4B_OB_${tf}_%d", (int)${P}zones[_k].obTime);
      string _ln = _rn + "_L";
      if(${P}zones[_k].state >= ${P}MITIGATED)
      {
         ObjectDelete(0, _rn);
         ObjectDelete(0, _ln);
         continue;
      }
      color _col = ${P}zones[_k].state == ${P}RETESTED  ? clrGold
                 : ${P}zones[_k].state == ${P}CONFIRMED  ? clrDimGray
                 : ${P}zones[_k].dir == 1                ? clrMediumSeaGreen
                 :                                         clrLightCoral;
      double _top = ${P}zones[_k].hi;
      double _bot = ${P}zones[_k].lo;
      if(ObjectFind(0, _rn) < 0)
         ObjectCreate(0, _rn, OBJ_RECTANGLE, 0, ${P}zones[_k].obTime, _top, _t2, _bot);
      ObjectSetInteger(0, _rn, OBJPROP_TIME,       1, _t2);
      ObjectSetInteger(0, _rn, OBJPROP_COLOR,         _col);
      ObjectSetInteger(0, _rn, OBJPROP_STYLE,         STYLE_SOLID);
      ObjectSetInteger(0, _rn, OBJPROP_WIDTH,         1);
      ObjectSetInteger(0, _rn, OBJPROP_BACK,          true);
      ObjectSetInteger(0, _rn, OBJPROP_FILL,          true);
      ObjectSetInteger(0, _rn, OBJPROP_SELECTABLE,    false);
      string _stxt = ${P}zones[_k].state == ${P}RETESTED  ? (${P}zones[_k].dir==1 ? "OB-T+" : "OB-T-")
                   : ${P}zones[_k].state == ${P}CONFIRMED  ? (${P}zones[_k].dir==1 ? "OB-C+" : "OB-C-")
                   :                                          (${P}zones[_k].dir==1 ? "OB+"   : "OB-");
      double _mid = (_top + _bot) * 0.5;
      if(ObjectFind(0, _ln) < 0)
         ObjectCreate(0, _ln, OBJ_TEXT, 0, ${P}zones[_k].obTime, _mid);
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
   for(int sh = lookback; sh >= 2; sh--) ${P}Detect(sh);
   ${P}Advance(1);
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
bool   ${P}BullJustRetested()  { return ${P}_bullJustRetested; }
bool   ${P}BearJustRetested()  { return ${P}_bearJustRetested; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==1 && ${P}zones[_k].state<=2) return true;
   return false;
}
bool ${P}HasActiveBear()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==-1 && ${P}zones[_k].state<=2) return true;
   return false;
}
double ${P}LatestBullLL()
{
   double best = 0;
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==1 && ${P}zones[_k].state<=2)
         { best = ${P}zones[_k].lo; break; }
   return best;
}
double ${P}LatestBearUL()
{
   double best = 0;
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==-1 && ${P}zones[_k].state<=2)
         { best = ${P}zones[_k].hi; break; }
   return best;
}
`;
}
