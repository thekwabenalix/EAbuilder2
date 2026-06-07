/**
 * Inline Miss State Machine Generator
 *
 * Playbook definition (Reactive/Malaysian SNR, Slide 27):
 *   "A miss is when price fails to touch a support/resistance — it comes close
 *    but doesn't touch it. The miss strengthens/validates the level and serves
 *    as liquidity. Very effective on higher timeframes."
 *
 * This SM embeds S/R level detection (Classic + Gap) and swing-pivot detection.
 * It fires when a confirmed swing turning point forms NEAR a level on the
 * correct side but does NOT reach it:
 *   Bullish miss (off SUPPORT):  a swing LOW forms just above support but its
 *     low never touches the level → demand respected the level without testing.
 *   Bearish miss (off RESISTANCE): a swing HIGH forms just below resistance but
 *     its high never reaches it → supply respected the level.
 *
 * Standard API:
 *   MISSSM_{id}_Reset()
 *   MISSSM_{id}_Tick(lookback)
 *   MISSSM_{id}_BullJustConfirmed()  — bullish miss above support this bar
 *   MISSSM_{id}_BearJustConfirmed()  — bearish miss below resistance this bar
 *   MISSSM_{id}_BullConfirmSL()      — the missed swing low (SL for longs)
 *   MISSSM_{id}_BearConfirmSL()      — the missed swing high (SL for shorts)
 *   MISSSM_{id}_HasActiveBull()      — a live support level exists
 *   MISSSM_{id}_HasActiveBear()      — a live resistance level exists
 */

export function genMissSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 40, // bars scanned for S/R levels each tick
  swingLen = 3, // pivot confirmation bars each side
  nearPoints = 50, // pivot must be within this many POINTS of the level
  expiryBars = 200,
): string {
  const P = `MISSSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Miss State Machine — ${tf} (${id})                              |
//| Swing pivot lands NEAR a level without touching = miss          |
//| Levels: Classic (reversal pair) + Gap (continuation pair)       |
//+------------------------------------------------------------------+
struct ${P}LevelRec
{
   int      dir;         //  1=support  -1=resistance
   double   level;       // candle A close — the SNR price
   datetime levelTime;   // candle A time
   datetime confirmTime; // candle B time — SNR valid only AFTER this
   bool     dead;
   int      barsAlive;
};

#define ${P}MAX_LEVELS 120
${P}LevelRec ${P}levels[${P}MAX_LEVELS];
int         ${P}levelCount     = 0;
bool        ${P}_bullConfirmed = false;
bool        ${P}_bearConfirmed = false;
double      ${P}_bullSL = 0.0;
double      ${P}_bearSL = 0.0;

void ${P}Reset()
{
   for(int _oi = ObjectsTotal(0) - 1; _oi >= 0; _oi--)
   {
      string _on = ObjectName(0, _oi);
      if(StringFind(_on, "4B_MISS_${tf}_") == 0) ObjectDelete(0, _on);
   }
   ${P}levelCount     = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

void ${P}AddLevel(int dir, double level, datetime tA, datetime tB)
{
   for(int _k = 0; _k < ${P}levelCount; _k++)
      if(${P}levels[_k].levelTime == tA) return;
   int idx = -1;
   for(int _k = 0; _k < ${P}levelCount; _k++)
      if(${P}levels[_k].dead) { idx = _k; break; }
   if(idx < 0) {
      if(${P}levelCount >= ${P}MAX_LEVELS) return;
      idx = ${P}levelCount++;
   }
   ${P}levels[idx].dir         = dir;
   ${P}levels[idx].level       = level;
   ${P}levels[idx].levelTime   = tA;
   ${P}levels[idx].confirmTime = tB;   // candle B — valid only after this
   ${P}levels[idx].dead        = false;
   ${P}levels[idx].barsAlive   = 0;
}

// ── Detect Classic + Gap S/R levels from candle pair (sh+1, sh) ────────
// SNR is a TWO-candle pattern: A close = level, B defines the type.
void ${P}Detect(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + 1 >= total) return;
   double aO = iOpen (InpSymbol, ${TF}, sh + 1);
   double aC = iClose(InpSymbol, ${TF}, sh + 1);
   double bO = iOpen (InpSymbol, ${TF}, sh);
   double bC = iClose(InpSymbol, ${TF}, sh);
   bool aBull = aC > aO, aBear = aC < aO;
   bool bBull = bC > bO, bBear = bC < bO;
   datetime tA = iTime(InpSymbol, ${TF}, sh + 1);
   datetime tB = iTime(InpSymbol, ${TF}, sh);
   if(aBull && bBear)      ${P}AddLevel(-1, aC, tA, tB);
   else if(aBear && bBull) ${P}AddLevel( 1, aC, tA, tB);
   else if(aBull && bBull) ${P}AddLevel( 1, aC, tA, tB);
   else if(aBear && bBear) ${P}AddLevel(-1, aC, tA, tB);
}

// ── Is bar sh a confirmed swing pivot? Returns 1=high, -1=low, 0=none ──
int ${P}PivotDir(int sh, int total)
{
   if(sh + ${swingLen} >= total || sh - ${swingLen} < 1) return 0;
   double hi = iHigh(InpSymbol, ${TF}, sh);
   double lo = iLow (InpSymbol, ${TF}, sh);
   bool isHigh = true, isLow = true;
   for(int _j = sh - ${swingLen}; _j <= sh + ${swingLen}; _j++)
   {
      if(_j == sh) continue;
      if(iHigh(InpSymbol, ${TF}, _j) >= hi) isHigh = false;
      if(iLow (InpSymbol, ${TF}, _j) <= lo) isLow  = false;
   }
   if(isHigh) return 1;
   if(isLow)  return -1;
   return 0;
}

// ── Check the just-confirmed pivot (at sh = swingLen+1) for a miss ─────
void ${P}CheckMiss()
{
   int total = iBars(InpSymbol, ${TF});
   int sh = ${swingLen} + 1;                 // newest pivot that can be confirmed
   int pd = ${P}PivotDir(sh, total);
   if(pd == 0) return;

   double pivLo = iLow (InpSymbol, ${TF}, sh);
   double pivHi = iHigh(InpSymbol, ${TF}, sh);
   double pt    = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   double near  = ${nearPoints} * pt;
   datetime pivT = iTime(InpSymbol, ${TF}, sh);

   for(int _k = 0; _k < ${P}levelCount; _k++)
   {
      if(${P}levels[_k].dead) continue;
      // The pivot must be after candle B (SNR not valid until B closes).
      if(pivT <= ${P}levels[_k].confirmTime) continue;
      double lvl = ${P}levels[_k].level;

      if(pd == -1 && ${P}levels[_k].dir == 1)   // swing LOW near SUPPORT
      {
         // Low stays ABOVE support but within "near" → a miss (didn't touch)
         if(pivLo > lvl && (pivLo - lvl) <= near)
         {
            ${P}_bullConfirmed = true;
            ${P}_bullSL = pivLo;
            PrintFormat("[MISSSM_${tf}] BULL MISS above support=%.5f pivotLow=%.5f SL=%.5f", lvl, pivLo, pivLo);
         }
      }
      else if(pd == 1 && ${P}levels[_k].dir == -1)  // swing HIGH near RESISTANCE
      {
         if(pivHi < lvl && (lvl - pivHi) <= near)
         {
            ${P}_bearConfirmed = true;
            ${P}_bearSL = pivHi;
            PrintFormat("[MISSSM_${tf}] BEAR MISS below resistance=%.5f pivotHigh=%.5f SL=%.5f", lvl, pivHi, pivHi);
         }
      }
   }
}

void ${P}Tick(int lookback)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   for(int sh = lookback; sh >= 1; sh--) ${P}Detect(sh);
   for(int _k = 0; _k < ${P}levelCount; _k++)
   {
      if(${P}levels[_k].dead) continue;
      ${P}levels[_k].barsAlive++;
      if(${P}levels[_k].barsAlive >= ${expiryBars}) ${P}levels[_k].dead = true;
   }
   ${P}CheckMiss();
   // ── Chart visualization: dashed level lines + arrow at pivot ────
   datetime _t2 = iTime(InpSymbol, PERIOD_CURRENT, 0) + PeriodSeconds(${TF}) * 20;
   for(int _k = 0; _k < ${P}levelCount; _k++)
   {
      string _ln = StringFormat("4B_MISS_${tf}_%d", (int)${P}levels[_k].levelTime);
      if(${P}levels[_k].dead) { ObjectDelete(0, _ln); continue; }
      color _col = ${P}levels[_k].dir == 1 ? clrCornflowerBlue : clrSalmon;
      if(ObjectFind(0, _ln) < 0)
         ObjectCreate(0, _ln, OBJ_TREND, 0, ${P}levels[_k].levelTime, ${P}levels[_k].level, _t2, ${P}levels[_k].level);
      ObjectSetInteger(0, _ln, OBJPROP_TIME,       1, _t2);
      ObjectSetDouble (0, _ln, OBJPROP_PRICE,      1, ${P}levels[_k].level);
      ObjectSetInteger(0, _ln, OBJPROP_COLOR,         _col);
      ObjectSetInteger(0, _ln, OBJPROP_STYLE,         STYLE_DOT);
      ObjectSetInteger(0, _ln, OBJPROP_WIDTH,         1);
      ObjectSetInteger(0, _ln, OBJPROP_RAY_RIGHT,     true);
      ObjectSetInteger(0, _ln, OBJPROP_SELECTABLE,    false);
   }
   if(${P}_bullConfirmed || ${P}_bearConfirmed)
   {
      datetime _bt = iTime(InpSymbol, ${TF}, 1);
      string   _an = StringFormat("4B_MISS_${tf}_sig_%d", (int)_bt);
      if(ObjectFind(0, _an) < 0)
      {
         if(${P}_bullConfirmed)
         {
            ObjectCreate(0, _an, OBJ_ARROW, 0, _bt, iLow(InpSymbol, ${TF}, 1));
            ObjectSetInteger(0, _an, OBJPROP_ARROWCODE, 233);
            ObjectSetInteger(0, _an, OBJPROP_COLOR,     clrSpringGreen);
            ObjectSetInteger(0, _an, OBJPROP_ANCHOR,    ANCHOR_TOP);
         }
         else
         {
            ObjectCreate(0, _an, OBJ_ARROW, 0, _bt, iHigh(InpSymbol, ${TF}, 1));
            ObjectSetInteger(0, _an, OBJPROP_ARROWCODE, 234);
            ObjectSetInteger(0, _an, OBJPROP_COLOR,     clrTomato);
            ObjectSetInteger(0, _an, OBJPROP_ANCHOR,    ANCHOR_BOTTOM);
         }
         ObjectSetInteger(0, _an, OBJPROP_WIDTH, 2);
         ObjectSetInteger(0, _an, OBJPROP_SELECTABLE, false);
      }
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }
bool   ${P}HasActiveBull()
{
   for(int _k=0;_k<${P}levelCount;_k++)
      if(${P}levels[_k].dir==1 && !${P}levels[_k].dead) return true;
   return false;
}
bool   ${P}HasActiveBear()
{
   for(int _k=0;_k<${P}levelCount;_k++)
      if(${P}levels[_k].dir==-1 && !${P}levels[_k].dead) return true;
   return false;
}
`;
}
