/**
 * Inline Classic S/R (SNR) State Machine Generator
 *
 * Detects horizontal support/resistance levels from candle-pair reversals,
 * then tracks each level through ACTIVE → RETESTED → CONFIRMED.
 *
 * Detection (Classic SNR):
 *   RESISTANCE: Bullish candle A → Bearish candle B → A.close = resistance
 *   SUPPORT:    Bearish candle A → Bullish candle B → A.close = support
 *
 * Lifecycle (single price line, no zone thickness):
 *   ACTIVE    → level created
 *   RETESTED  → wick reaches the level from the correct side
 *   CONFIRMED → from RETESTED, close holds on the correct side (signal)
 *   BROKEN    → close on the wrong side [terminal]
 *   EXPIRED   → barsAlive ≥ expiryBars [terminal]
 *
 * Standard API:
 *   SNRSM_{id}_Reset()
 *   SNRSM_{id}_Tick(lookback)
 *   SNRSM_{id}_BullJustConfirmed()  — support held this bar (bullish entry)
 *   SNRSM_{id}_BearJustConfirmed()  — resistance held this bar (bearish entry)
 *   SNRSM_{id}_BullConfirmSL()      — retestLow at last support confirmation
 *   SNRSM_{id}_BearConfirmSL()      — retestHigh at last resistance confirmation
 *   SNRSM_{id}_HasActiveBull()      — a live support level exists
 *   SNRSM_{id}_HasActiveBear()      — a live resistance level exists
 */

export function genSnrSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 20,      // bars scanned for new levels each tick
  expiryBars = 100,
): string {
  const P = `SNRSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Classic SNR State Machine — ${tf} (${id})                      |
//| RESISTANCE: bull→bear pair · SUPPORT: bear→bull pair           |
//| States: ACTIVE → RETESTED → CONFIRMED | BROKEN/EXPIRED         |
//+------------------------------------------------------------------+
#define ${P}ACTIVE       0
#define ${P}RETESTED     1
#define ${P}CONFIRMED    2
#define ${P}BROKEN       3
#define ${P}EXPIRED      4

struct ${P}LevelRec
{
   int      dir;         //  1=support  -1=resistance
   double   level;       // candle A close — the SNR price
   datetime levelTime;   // candle A time (price origin)
   datetime confirmTime; // candle B time — SNR valid only AFTER this bar
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

// ── Detect a Classic SNR level from the candle pair at (sh+1, sh) ──────
void ${P}Detect(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + 1 >= total) return;

   // Candle A is the older candle (sh+1), candle B is the newer (sh)
   double aO = iOpen (InpSymbol, ${TF}, sh + 1);
   double aC = iClose(InpSymbol, ${TF}, sh + 1);
   double bO = iOpen (InpSymbol, ${TF}, sh);
   double bC = iClose(InpSymbol, ${TF}, sh);

   bool aBull = aC > aO;
   bool aBear = aC < aO;
   bool bBull = bC > bO;
   bool bBear = bC < bO;

   int dir = 0;
   if(aBull && bBear) dir = -1;   // resistance: A.close
   else if(aBear && bBull) dir = 1;  // support: A.close
   else return;

   double level = aC;
   datetime lvlT = iTime(InpSymbol, ${TF}, sh + 1);

   // dedup by candle-A time
   for(int _k = 0; _k < ${P}levelCount; _k++)
      if(${P}levels[_k].levelTime == lvlT) return;

   // slot: recycle terminal level
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
   ${P}levels[idx].confirmTime   = iTime(InpSymbol, ${TF}, sh);  // candle B time
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
   datetime bt = iTime(InpSymbol, ${TF}, sh);

   for(int _k = 0; _k < ${P}levelCount; _k++)
   {
      if(${P}levels[_k].state >= ${P}BROKEN) continue;
      // SNR is a two-candle pattern — do not test it until AFTER candle B.
      if(bt <= ${P}levels[_k].confirmTime) continue;
      ${P}levels[_k].barsAlive++;
      ${P}levels[_k].justConfirmed = false;

      if(${P}levels[_k].barsAlive >= ${expiryBars}) { ${P}levels[_k].state = ${P}EXPIRED; continue; }

      double lvl = ${P}levels[_k].level;

      if(${P}levels[_k].dir == 1)  // ── SUPPORT ───────────────────────────
      {
         // BROKEN: close below the support
         if(cl < lvl) { ${P}levels[_k].state = ${P}BROKEN; continue; }
         // RETESTED: wick reaches down to the level
         if(${P}levels[_k].state == ${P}ACTIVE && lo <= lvl)
         {
            ${P}levels[_k].state = ${P}RETESTED;
            ${P}levels[_k].retestLow = lo;
         }
         if(${P}levels[_k].state == ${P}RETESTED)
         {
            if(lo < ${P}levels[_k].retestLow) ${P}levels[_k].retestLow = lo;
            // CONFIRMED: close holds above support
            if(cl > lvl)
            {
               ${P}levels[_k].state = ${P}CONFIRMED;
               ${P}levels[_k].justConfirmed = true;
               ${P}_bullConfirmed = true;
               ${P}_bullSL = ${P}levels[_k].retestLow;
               PrintFormat("[SNRSM_${tf}] SUPPORT CONFIRMED lvl=%.5f SL=%.5f", lvl, ${P}levels[_k].retestLow);
            }
         }
         // cycle: new touch after confirmation
         if(${P}levels[_k].state == ${P}CONFIRMED && lo <= lvl)
         { ${P}levels[_k].state = ${P}RETESTED; ${P}levels[_k].retestLow = lo; }
      }
      else  // ── RESISTANCE ──────────────────────────────────────────────
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
               PrintFormat("[SNRSM_${tf}] RESISTANCE CONFIRMED lvl=%.5f SL=%.5f", lvl, ${P}levels[_k].retestHigh);
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
