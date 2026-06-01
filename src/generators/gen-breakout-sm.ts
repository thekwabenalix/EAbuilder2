/**
 * Inline Breakout State Machine Generator
 *
 * Detects a candle-close breakout of a recent range extreme, then tracks the
 * broken level as it flips polarity (RBS / SBR) and gets retested.
 *
 *   Bullish breakout: close above the recent range HIGH → the broken high
 *     becomes support (RBS — Resistance Becomes Support). Confirmed when price
 *     retests it from above and closes back up.
 *   Bearish breakout: close below the recent range LOW → the broken low becomes
 *     resistance (SBR — Support Becomes Resistance).
 *
 * Lifecycle:
 *   ACTIVE   → breakout close confirmed, flip level recorded
 *   RETESTED → price wicks back to the flipped level from the correct side
 *   CONFIRMED→ close holds on the breakout side (entry signal)
 *   INVALIDATED → close back through the level [terminal]
 *   EXPIRED  → barsAlive ≥ expiryBars [terminal]
 *
 * Standard API:
 *   BRKSM_{id}_Reset()
 *   BRKSM_{id}_Tick(lookback)
 *   BRKSM_{id}_BullJustConfirmed()  — RBS retest held (bullish entry)
 *   BRKSM_{id}_BearJustConfirmed()  — SBR retest held (bearish entry)
 *   BRKSM_{id}_BullConfirmSL()      — retestLow at last RBS confirmation
 *   BRKSM_{id}_BearConfirmSL()      — retestHigh at last SBR confirmation
 *   BRKSM_{id}_HasActiveBull()      — a live RBS level exists
 *   BRKSM_{id}_HasActiveBear()      — a live SBR level exists
 */

export function genBreakoutSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 20, // range whose high/low defines the breakout level
  expiryBars = 100,
): string {
  const P = `BRKSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Breakout State Machine — ${tf} (${id})                          |
//| Close beyond range → flip (RBS/SBR) → retest → CONFIRMED        |
//+------------------------------------------------------------------+
#define ${P}ACTIVE       0
#define ${P}RETESTED     1
#define ${P}CONFIRMED    2
#define ${P}INVALIDATED  3
#define ${P}EXPIRED      4

struct ${P}FlipRec
{
   int      dir;        //  1=RBS (support)  -1=SBR (resistance)
   double   level;      // broken level that flipped
   datetime breakTime;
   int      state;
   int      barsAlive;
   double   retestHigh;
   double   retestLow;
   bool     justConfirmed;
};

#define ${P}MAX_FLIPS 60
${P}FlipRec ${P}flips[${P}MAX_FLIPS];
int         ${P}flipCount      = 0;
bool        ${P}_bullConfirmed = false;
bool        ${P}_bearConfirmed = false;
double      ${P}_bullSL = 0.0;
double      ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}flipCount      = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

// ── Detect a breakout of the recent range at bar sh ───────────────────
void ${P}Detect(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + ${lookback} >= total) return;

   // Range high/low over the lookback window BEFORE the breakout bar
   double rngHi = iHigh(InpSymbol, ${TF}, sh + 1);
   double rngLo = iLow (InpSymbol, ${TF}, sh + 1);
   for(int _j = sh + 2; _j <= sh + ${lookback}; _j++)
   {
      double h = iHigh(InpSymbol, ${TF}, _j);
      double l = iLow (InpSymbol, ${TF}, _j);
      if(h > rngHi) rngHi = h;
      if(l < rngLo) rngLo = l;
   }

   double cl = iClose(InpSymbol, ${TF}, sh);
   int dir = 0;
   double level = 0;
   if(cl > rngHi) { dir = 1;  level = rngHi; }   // bullish breakout → RBS at old high
   else if(cl < rngLo) { dir = -1; level = rngLo; }  // bearish breakout → SBR at old low
   else return;

   datetime bT = iTime(InpSymbol, ${TF}, sh);

   // dedup: skip if a live flip already sits near this level
   double pt = SymbolInfoDouble(InpSymbol, SYMBOL_POINT);
   for(int _k = 0; _k < ${P}flipCount; _k++)
      if(${P}flips[_k].state < ${P}INVALIDATED &&
         MathAbs(${P}flips[_k].level - level) < 5 * pt) return;

   int idx = -1;
   for(int _k = 0; _k < ${P}flipCount; _k++)
      if(${P}flips[_k].state >= ${P}INVALIDATED) { idx = _k; break; }
   if(idx < 0) {
      if(${P}flipCount >= ${P}MAX_FLIPS) return;
      idx = ${P}flipCount++;
   }
   ${P}flips[idx].dir           = dir;
   ${P}flips[idx].level         = level;
   ${P}flips[idx].breakTime     = bT;
   ${P}flips[idx].state         = ${P}ACTIVE;
   ${P}flips[idx].barsAlive     = 0;
   ${P}flips[idx].retestHigh    = 0;
   ${P}flips[idx].retestLow     = 1e10;
   ${P}flips[idx].justConfirmed = false;
}

// ── Advance state for bar sh ──────────────────────────────────────────
void ${P}Advance(int sh)
{
   double lo = iLow  (InpSymbol, ${TF}, sh);
   double hi = iHigh (InpSymbol, ${TF}, sh);
   double cl = iClose(InpSymbol, ${TF}, sh);

   for(int _k = 0; _k < ${P}flipCount; _k++)
   {
      if(${P}flips[_k].state >= ${P}INVALIDATED) continue;
      ${P}flips[_k].barsAlive++;
      ${P}flips[_k].justConfirmed = false;

      if(${P}flips[_k].barsAlive >= ${expiryBars}) { ${P}flips[_k].state = ${P}EXPIRED; continue; }

      double lvl = ${P}flips[_k].level;

      if(${P}flips[_k].dir == 1)  // ── RBS (flipped support) ───────────────
      {
         // INVALIDATED: close back below the flipped level
         if(cl < lvl) { ${P}flips[_k].state = ${P}INVALIDATED; continue; }
         if(${P}flips[_k].state == ${P}ACTIVE && lo <= lvl)
         {
            ${P}flips[_k].state = ${P}RETESTED;
            ${P}flips[_k].retestLow = lo;
         }
         if(${P}flips[_k].state == ${P}RETESTED)
         {
            if(lo < ${P}flips[_k].retestLow) ${P}flips[_k].retestLow = lo;
            if(cl > lvl)
            {
               ${P}flips[_k].state = ${P}CONFIRMED;
               ${P}flips[_k].justConfirmed = true;
               ${P}_bullConfirmed = true;
               ${P}_bullSL = ${P}flips[_k].retestLow;
               PrintFormat("[BRKSM_${tf}] RBS CONFIRMED lvl=%.5f SL=%.5f", lvl, ${P}flips[_k].retestLow);
            }
         }
         if(${P}flips[_k].state == ${P}CONFIRMED && lo <= lvl)
         { ${P}flips[_k].state = ${P}RETESTED; ${P}flips[_k].retestLow = lo; }
      }
      else  // ── SBR (flipped resistance) ────────────────────────────────
      {
         if(cl > lvl) { ${P}flips[_k].state = ${P}INVALIDATED; continue; }
         if(${P}flips[_k].state == ${P}ACTIVE && hi >= lvl)
         {
            ${P}flips[_k].state = ${P}RETESTED;
            ${P}flips[_k].retestHigh = hi;
         }
         if(${P}flips[_k].state == ${P}RETESTED)
         {
            if(hi > ${P}flips[_k].retestHigh) ${P}flips[_k].retestHigh = hi;
            if(cl < lvl)
            {
               ${P}flips[_k].state = ${P}CONFIRMED;
               ${P}flips[_k].justConfirmed = true;
               ${P}_bearConfirmed = true;
               ${P}_bearSL = ${P}flips[_k].retestHigh;
               PrintFormat("[BRKSM_${tf}] SBR CONFIRMED lvl=%.5f SL=%.5f", lvl, ${P}flips[_k].retestHigh);
            }
         }
         if(${P}flips[_k].state == ${P}CONFIRMED && hi >= lvl)
         { ${P}flips[_k].state = ${P}RETESTED; ${P}flips[_k].retestHigh = hi; }
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
   for(int _k=0;_k<${P}flipCount;_k++)
      if(${P}flips[_k].dir==1 && ${P}flips[_k].state<=${P}CONFIRMED) return true;
   return false;
}
bool   ${P}HasActiveBear()
{
   for(int _k=0;_k<${P}flipCount;_k++)
      if(${P}flips[_k].dir==-1 && ${P}flips[_k].state<=${P}CONFIRMED) return true;
   return false;
}
`;
}
