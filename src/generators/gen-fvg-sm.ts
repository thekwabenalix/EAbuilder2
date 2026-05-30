/**
 * Inline FVG State Machine Generator
 *
 * Embeds FVG detection + full lifecycle state machine directly in an EA.
 * No external indicator required — zero dependencies.
 *
 * States: ACTIVE → RETESTED → CONFIRMED (→ re-RETESTED → ...) | MITIGATED | INVALIDATED | EXPIRED
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
  id: string,          // e.g. "H4"  → prefix FVGSM_H4_
  TF: string,          // e.g. "PERIOD_H4"
  tf: string,          // e.g. "H4"  (log messages)
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
double      ${P}_bullSL = 0.0;
double      ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}zoneCount      = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
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

   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      ${P}FvgRec *z = GetPointer(${P}zones[_k]);
      if(z.state >= ${P}MITIGATED) continue;

      z.barsAlive++;
      z.justConfirmed = false;

      // Expiry
      if(z.barsAlive >= ${expiryBars}) { z.state = ${P}EXPIRED; continue; }

      if(z.dir == 1)  // ── BULL FVG ─────────────────────────────────
      {
         // MITIGATED: close inside zone
         if(cl >= z.ll && cl <= z.ul) { z.state = ${P}MITIGATED; continue; }
         // INVALIDATED: close below far edge
         if(cl < z.ll) { z.state = ${P}INVALIDATED; continue; }
         // RETESTED: wick enters zone from above
         if(z.state == ${P}ACTIVE && lo <= z.ul)
         {
            z.state = ${P}RETESTED;
            z.retestLow = lo;
         }
         if(z.state == ${P}RETESTED)
         {
            if(lo < z.retestLow) z.retestLow = lo;   // track worst wick
            // CONFIRMED: close back above UL
            if(cl > z.ul) {
               z.state = ${P}CONFIRMED;
               z.justConfirmed = true;
               z.confirmSL = z.retestLow;
               ${P}_bullConfirmed = true;
               ${P}_bullSL = z.retestLow;
               PrintFormat("[FVGSM_${tf}] BULL CONFIRMED UL=%.5f SL=%.5f", z.ul, z.retestLow);
            }
         }
         // Post-CONFIRMED: allow cycling
         if(z.state == ${P}CONFIRMED && lo <= z.ul)
         {
            z.state = ${P}RETESTED;
            z.retestLow = lo;
         }
      }
      else  // ── BEAR FVG ─────────────────────────────────────────
      {
         if(cl >= z.ll && cl <= z.ul) { z.state = ${P}MITIGATED; continue; }
         if(cl > z.ul) { z.state = ${P}INVALIDATED; continue; }
         if(z.state == ${P}ACTIVE && hi >= z.ll)
         {
            z.state = ${P}RETESTED;
            z.retestHigh = hi;
         }
         if(z.state == ${P}RETESTED)
         {
            if(hi > z.retestHigh) z.retestHigh = hi;
            if(cl < z.ll) {
               z.state = ${P}CONFIRMED;
               z.justConfirmed = true;
               z.confirmSL = z.retestHigh;
               ${P}_bearConfirmed = true;
               ${P}_bearSL = z.retestHigh;
               PrintFormat("[FVGSM_${tf}] BEAR CONFIRMED LL=%.5f SL=%.5f", z.ll, z.retestHigh);
            }
         }
         if(z.state == ${P}CONFIRMED && hi >= z.ll)
         {
            z.state = ${P}RETESTED;
            z.retestHigh = hi;
         }
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
