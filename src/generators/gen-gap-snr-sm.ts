/**
 * Inline Gap S/R (Gap SNR) State Machine Generator
 *
 * Identical lifecycle to Classic SNR — only the detection differs.
 * Gap SNR uses candle-pair CONTINUATION instead of reversal:
 *   GAP SUPPORT:    Bullish candle A → Bullish candle B → A.close = support
 *   GAP RESISTANCE: Bearish candle A → Bearish candle B → A.close = resistance
 *
 * Lifecycle (single price line):
 *   ACTIVE → RETESTED → CONFIRMED | BROKEN | EXPIRED
 *
 * Standard API:
 *   GSNRSM_{id}_Reset()
 *   GSNRSM_{id}_Tick(lookback)
 *   GSNRSM_{id}_BullJustConfirmed()  — gap support held this bar
 *   GSNRSM_{id}_BearJustConfirmed()  — gap resistance held this bar
 *   GSNRSM_{id}_BullConfirmSL()      — retestLow at last support confirmation
 *   GSNRSM_{id}_BearConfirmSL()      — retestHigh at last resistance confirmation
 *   GSNRSM_{id}_HasActiveBull()      — a live gap support level exists
 *   GSNRSM_{id}_HasActiveBear()      — a live gap resistance level exists
 */

export function genGapSnrSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 20,
  expiryBars = 100,
): string {
  const P = `GSNRSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Gap SNR State Machine — ${tf} (${id})                          |
//| SUPPORT: bull→bull pair · RESISTANCE: bear→bear pair           |
//| States: ACTIVE → RETESTED → CONFIRMED | BROKEN/EXPIRED         |
//+------------------------------------------------------------------+
#define ${P}ACTIVE       0
#define ${P}RETESTED     1
#define ${P}CONFIRMED    2
#define ${P}BROKEN       3
#define ${P}EXPIRED      4

struct ${P}LevelRec
{
   int      dir;        //  1=support  -1=resistance
   double   level;
   datetime levelTime;
   int      state;
   int      barsAlive;
   double   retestHigh;
   double   retestLow;
   bool     justConfirmed;
};

#define ${P}MAX_LEVELS 100
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

// ── Detect a Gap SNR level from the candle pair at (sh+1, sh) ──────────
void ${P}Detect(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + 1 >= total) return;

   double aO = iOpen (InpSymbol, ${TF}, sh + 1);
   double aC = iClose(InpSymbol, ${TF}, sh + 1);
   double bO = iOpen (InpSymbol, ${TF}, sh);
   double bC = iClose(InpSymbol, ${TF}, sh);

   bool aBull = aC > aO;
   bool aBear = aC < aO;
   bool bBull = bC > bO;
   bool bBear = bC < bO;

   int dir = 0;
   if(aBull && bBull) dir = 1;    // gap support: A.close
   else if(aBear && bBear) dir = -1;  // gap resistance: A.close
   else return;

   double level = aC;
   datetime lvlT = iTime(InpSymbol, ${TF}, sh + 1);

   for(int _k = 0; _k < ${P}levelCount; _k++)
      if(${P}levels[_k].levelTime == lvlT) return;

   int idx = -1;
   for(int _k = 0; _k < ${P}levelCount; _k++)
      if(${P}levels[_k].state >= ${P}BROKEN) { idx = _k; break; }
   if(idx < 0) {
      if(${P}levelCount >= ${P}MAX_LEVELS) return;
      idx = ${P}levelCount++;
   }
   ${P}levels[idx].dir           = dir;
   ${P}levels[idx].level         = level;
   ${P}levels[idx].levelTime     = lvlT;
   ${P}levels[idx].state         = ${P}ACTIVE;
   ${P}levels[idx].barsAlive     = 0;
   ${P}levels[idx].retestHigh    = 0;
   ${P}levels[idx].retestLow     = 1e10;
   ${P}levels[idx].justConfirmed = false;
}

// ── Advance state for bar sh ──────────────────────────────────────────
void ${P}Advance(int sh)
{
   double lo = iLow  (InpSymbol, ${TF}, sh);
   double hi = iHigh (InpSymbol, ${TF}, sh);
   double cl = iClose(InpSymbol, ${TF}, sh);

   for(int _k = 0; _k < ${P}levelCount; _k++)
   {
      if(${P}levels[_k].state >= ${P}BROKEN) continue;
      ${P}levels[_k].barsAlive++;
      ${P}levels[_k].justConfirmed = false;

      if(${P}levels[_k].barsAlive >= ${expiryBars}) { ${P}levels[_k].state = ${P}EXPIRED; continue; }

      double lvl = ${P}levels[_k].level;

      if(${P}levels[_k].dir == 1)  // ── GAP SUPPORT ───────────────────────
      {
         if(cl < lvl) { ${P}levels[_k].state = ${P}BROKEN; continue; }
         if(${P}levels[_k].state == ${P}ACTIVE && lo <= lvl)
         {
            ${P}levels[_k].state = ${P}RETESTED;
            ${P}levels[_k].retestLow = lo;
         }
         if(${P}levels[_k].state == ${P}RETESTED)
         {
            if(lo < ${P}levels[_k].retestLow) ${P}levels[_k].retestLow = lo;
            if(cl > lvl)
            {
               ${P}levels[_k].state = ${P}CONFIRMED;
               ${P}levels[_k].justConfirmed = true;
               ${P}_bullConfirmed = true;
               ${P}_bullSL = ${P}levels[_k].retestLow;
               PrintFormat("[GSNRSM_${tf}] GAP SUPPORT CONFIRMED lvl=%.5f SL=%.5f", lvl, ${P}levels[_k].retestLow);
            }
         }
         if(${P}levels[_k].state == ${P}CONFIRMED && lo <= lvl)
         { ${P}levels[_k].state = ${P}RETESTED; ${P}levels[_k].retestLow = lo; }
      }
      else  // ── GAP RESISTANCE ─────────────────────────────────────────
      {
         if(cl > lvl) { ${P}levels[_k].state = ${P}BROKEN; continue; }
         if(${P}levels[_k].state == ${P}ACTIVE && hi >= lvl)
         {
            ${P}levels[_k].state = ${P}RETESTED;
            ${P}levels[_k].retestHigh = hi;
         }
         if(${P}levels[_k].state == ${P}RETESTED)
         {
            if(hi > ${P}levels[_k].retestHigh) ${P}levels[_k].retestHigh = hi;
            if(cl < lvl)
            {
               ${P}levels[_k].state = ${P}CONFIRMED;
               ${P}levels[_k].justConfirmed = true;
               ${P}_bearConfirmed = true;
               ${P}_bearSL = ${P}levels[_k].retestHigh;
               PrintFormat("[GSNRSM_${tf}] GAP RESISTANCE CONFIRMED lvl=%.5f SL=%.5f", lvl, ${P}levels[_k].retestHigh);
            }
         }
         if(${P}levels[_k].state == ${P}CONFIRMED && hi >= lvl)
         { ${P}levels[_k].state = ${P}RETESTED; ${P}levels[_k].retestHigh = hi; }
      }
   }
}

void ${P}Tick(int lookback)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   for(int sh = lookback; sh >= 1; sh--) ${P}Detect(sh);
   ${P}Advance(1);
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }
bool   ${P}HasActiveBull()
{
   for(int _k=0;_k<${P}levelCount;_k++)
      if(${P}levels[_k].dir==1 && ${P}levels[_k].state<=${P}CONFIRMED) return true;
   return false;
}
bool   ${P}HasActiveBear()
{
   for(int _k=0;_k<${P}levelCount;_k++)
      if(${P}levels[_k].dir==-1 && ${P}levels[_k].state<=${P}CONFIRMED) return true;
   return false;
}
`;
}
