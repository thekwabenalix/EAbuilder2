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
  lookback = 40,        // bars scanned for S/R levels each tick
  swingLen = 3,         // pivot confirmation bars each side
  nearPoints = 50,      // pivot must be within this many POINTS of the level
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
   int      dir;        //  1=support  -1=resistance
   double   level;
   datetime levelTime;
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
   ${P}levelCount     = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

void ${P}AddLevel(int dir, double level, datetime lvlT)
{
   for(int _k = 0; _k < ${P}levelCount; _k++)
      if(${P}levels[_k].levelTime == lvlT) return;
   int idx = -1;
   for(int _k = 0; _k < ${P}levelCount; _k++)
      if(${P}levels[_k].dead) { idx = _k; break; }
   if(idx < 0) {
      if(${P}levelCount >= ${P}MAX_LEVELS) return;
      idx = ${P}levelCount++;
   }
   ${P}levels[idx].dir       = dir;
   ${P}levels[idx].level     = level;
   ${P}levels[idx].levelTime = lvlT;
   ${P}levels[idx].dead      = false;
   ${P}levels[idx].barsAlive = 0;
}

// ── Detect Classic + Gap S/R levels from candle pair (sh+1, sh) ────────
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
   datetime lvlT = iTime(InpSymbol, ${TF}, sh + 1);
   if(aBull && bBear)      ${P}AddLevel(-1, aC, lvlT);
   else if(aBear && bBull) ${P}AddLevel( 1, aC, lvlT);
   else if(aBull && bBull) ${P}AddLevel( 1, aC, lvlT);
   else if(aBear && bBear) ${P}AddLevel(-1, aC, lvlT);
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

   for(int _k = 0; _k < ${P}levelCount; _k++)
   {
      if(${P}levels[_k].dead) continue;
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
