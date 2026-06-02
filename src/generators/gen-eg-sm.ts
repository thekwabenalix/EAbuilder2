/**
 * Inline Engulfing + Engulfing Failed State Machine Generator
 *
 * EG  (Engulfing)        — C2 closes beyond C1's full wick → zone = C1 wick range
 * EF  (Engulfing Failed) — an EG that price closed through; zone stays, direction flips
 *
 * Based on the Malaysian Engulfing Strategy (MES) definition:
 *   • Bullish EG : C1 bearish,  C2 bullish and closes ABOVE C1.High (upper wick)
 *   • Bearish EG : C1 bullish,  C2 bearish and closes BELOW C1.Low  (lower wick)
 *   • Zone = C1 full wick range (hi = C1.High, lo = C1.Low)
 *   • Bull EG fails → a bearish candle closes BELOW C1.Low  → becomes Bear EF zone
 *   • Bear EG fails → a bullish candle closes ABOVE C1.High → becomes Bull EF zone
 *
 * EF is NOT a Breaker Block. It is simply a failed EG — price closed through the
 * zone. No BOS or displacement context is required. The same C1 wick boundaries
 * are reused as the EF zone, now acting as a zone in the opposite direction.
 *
 * Analogous to Order Block (zone defined by candle body vs EG zone by wick).
 *
 * Standard API (mirrors OB SM):
 *   EGSM_{id}_Reset()
 *   EGSM_{id}_Tick(lookback)
 *   EGSM_{id}_BullJustConfirmed()   — bull zone confirmed this bar (EG or EF)
 *   EGSM_{id}_BearJustConfirmed()   — bear zone confirmed this bar (EG or EF)
 *   EGSM_{id}_BullConfirmSL()       — retestLow at last bull confirmation
 *   EGSM_{id}_BearConfirmSL()       — retestHigh at last bear confirmation
 *   EGSM_{id}_HasActiveBull()       — any live bull zone (EG or EF)
 *   EGSM_{id}_HasActiveBear()       — any live bear zone (EG or EF)
 *   EGSM_{id}_LatestBullUL()        — upper limit of most recent bull zone
 *   EGSM_{id}_LatestBullLL()        — lower limit of most recent bull zone
 *   EGSM_{id}_LatestBearUL()        — upper limit of most recent bear zone
 *   EGSM_{id}_LatestBearLL()        — lower limit of most recent bear zone
 *   EGSM_{id}_LatestBullZoneTime()  — C1 time of most recent bull zone (for drawing)
 *   EGSM_{id}_LatestBearZoneTime()  — C1 time of most recent bear zone (for drawing)
 */

export function genEgSM(
  id: string,
  TF: string,        // MQL5 PERIOD constant e.g. "PERIOD_M5"
  tf: string,        // Human-readable label e.g. "M5"
  scanBack = 3,      // bars to scan back for new EG patterns each tick
  expiryBars = 100,  // bars until an untested zone expires
): string {
  const P = `EGSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| EG+EF State Machine — ${tf} (instance: ${id})
//| EG: C2 closes beyond C1 wick → zone = C1 full wick range
//| EF: a failed EG — price closed through zone → same zone, direction flipped
//| States: ACTIVE → RETESTED → CONFIRMED | EF flip | MITIGATED/EXPIRED
//+------------------------------------------------------------------+
#define ${P}ACTIVE      0
#define ${P}RETESTED    1
#define ${P}CONFIRMED   2
#define ${P}MITIGATED   3
#define ${P}INVALIDATED 4
#define ${P}EXPIRED     5

struct ${P}ZoneRec
{
   int      dir;          //  1 = bull zone   -1 = bear zone (current; may be flipped EF)
   bool     isEF;         // true when this zone is an EF (original EG that failed)
   double   hi;           // C1 upper wick (High of engulfed candle)
   double   lo;           // C1 lower wick (Low  of engulfed candle)
   datetime c1Time;       // time of the engulfed candle (C1)
   int      state;
   int      barsAlive;
   double   retestHigh;
   double   retestLow;
   bool     justConfirmed;
   double   confirmSL;
};

#define ${P}MAX_ZONES 200
${P}ZoneRec ${P}zones[${P}MAX_ZONES];
int         ${P}zoneCount      = 0;
bool        ${P}_bullConfirmed = false;
bool        ${P}_bearConfirmed = false;
double      ${P}_bullSL        = 0.0;
double      ${P}_bearSL        = 0.0;

void ${P}Reset()
{
   ${P}zoneCount      = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL        = 0.0;
   ${P}_bearSL        = 0.0;
}

// ── Detect EG at bar sh (C2 = sh, C1 = sh+1) ────────────────────────────────
// MES rule: close beyond the WICK of the opposite candle, not just the body.
void ${P}Detect(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + 1 >= total) return;

   double c2O = iOpen (InpSymbol, ${TF}, sh);
   double c2C = iClose(InpSymbol, ${TF}, sh);
   double c1O = iOpen (InpSymbol, ${TF}, sh + 1);
   double c1C = iClose(InpSymbol, ${TF}, sh + 1);
   double c1H = iHigh (InpSymbol, ${TF}, sh + 1);   // upper wick of engulfed candle
   double c1L = iLow  (InpSymbol, ${TF}, sh + 1);   // lower wick of engulfed candle
   datetime c1T = iTime(InpSymbol, ${TF}, sh + 1);

   // Bullish EG: C1 bearish, C2 bullish and closes ABOVE C1 upper wick
   bool isBullEG = (c1C < c1O) && (c2C > c2O) && (c2C > c1H);
   // Bearish EG: C1 bullish, C2 bearish and closes BELOW C1 lower wick
   bool isBearEG = (c1C > c1O) && (c2C < c2O) && (c2C < c1L);
   if(!isBullEG && !isBearEG) return;

   // Dedup: one zone per C1 time
   for(int _k = 0; _k < ${P}zoneCount; _k++)
      if(${P}zones[_k].c1Time == c1T) return;

   // Consolidate: supersede older live zones overlapping this new one (keep recent)
   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      if(${P}zones[_k].state >= ${P}MITIGATED) continue;
      if(${P}zones[_k].lo <= c1H && c1L <= ${P}zones[_k].hi)  // price ranges overlap
      {
         ${P}zones[_k].state = ${P}INVALIDATED;
         PrintFormat("[EGSM_${tf}] OVERLAP superseded | old=[%.5f,%.5f] by new=[%.5f,%.5f]",
                     ${P}zones[_k].hi, ${P}zones[_k].lo, c1H, c1L);
      }
   }

   // Slot: recycle a terminal zone first, else append
   int idx = -1;
   for(int _k = 0; _k < ${P}zoneCount; _k++)
      if(${P}zones[_k].state >= ${P}MITIGATED) { idx = _k; break; }
   if(idx < 0) {
      if(${P}zoneCount >= ${P}MAX_ZONES) return;
      idx = ${P}zoneCount++;
   }

   ${P}zones[idx].dir           = isBullEG ? 1 : -1;
   ${P}zones[idx].isEF          = false;
   ${P}zones[idx].hi            = c1H;
   ${P}zones[idx].lo            = c1L;
   ${P}zones[idx].c1Time        = c1T;
   ${P}zones[idx].state         = ${P}ACTIVE;
   ${P}zones[idx].barsAlive     = 0;
   ${P}zones[idx].retestHigh    = 0.0;
   ${P}zones[idx].retestLow     = 1e10;
   ${P}zones[idx].justConfirmed = false;
   ${P}zones[idx].confirmSL     = 0.0;

   PrintFormat("[EGSM_${tf}] %s EG detected | hi=%.5f lo=%.5f | C1=%s",
               isBullEG?"BULL":"BEAR", c1H, c1L,
               TimeToString(c1T, TIME_DATE|TIME_MINUTES));
}

// ── Advance all live zone states for the last closed bar (sh = 1) ────────────
void ${P}Advance(int sh)
{
   double barLo = iLow  (InpSymbol, ${TF}, sh);
   double barHi = iHigh (InpSymbol, ${TF}, sh);
   double barCl = iClose(InpSymbol, ${TF}, sh);

   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      if(${P}zones[_k].state >= ${P}MITIGATED) continue;
      ${P}zones[_k].barsAlive++;
      ${P}zones[_k].justConfirmed = false;

      if(${P}zones[_k].barsAlive >= ${expiryBars})
         { ${P}zones[_k].state = ${P}EXPIRED; continue; }

      double hi = ${P}zones[_k].hi;
      double lo = ${P}zones[_k].lo;

      if(${P}zones[_k].dir == 1)  // ── BULL zone (EG or Bull EF) ─────────────
      {
         // EG only: if original EG and price closes below lo → zone failed → Bear EF
         if(!${P}zones[_k].isEF && barCl < lo)
         {
            ${P}zones[_k].dir        = -1;
            ${P}zones[_k].isEF       = true;
            ${P}zones[_k].state      = ${P}ACTIVE;
            ${P}zones[_k].barsAlive  = 0;
            ${P}zones[_k].retestHigh = 0.0;
            ${P}zones[_k].retestLow  = 1e10;
            PrintFormat("[EGSM_${tf}] BULL EG FAILED → BEAR EF | hi=%.5f lo=%.5f", hi, lo);
            continue;
         }
         // EF only: if the EF also fails (close > hi) → fully invalidated (deleted)
         if(${P}zones[_k].isEF && barCl > hi)
            { ${P}zones[_k].state = ${P}INVALIDATED;
              PrintFormat("[EGSM_${tf}] BEAR EF BROKEN → deleted | hi=%.5f lo=%.5f", hi, lo);
              continue; }
         // ACTIVE → RETESTED: wick enters zone from above
         if(${P}zones[_k].state == ${P}ACTIVE && barLo <= hi)
         {
            ${P}zones[_k].state    = ${P}RETESTED;
            ${P}zones[_k].retestLow = barLo;
            PrintFormat("[EGSM_${tf}] %s BULL RETESTED | hi=%.5f retestLow=%.5f",
                        ${P}zones[_k].isEF?"EF":"EG", hi, barLo);
         }
         if(${P}zones[_k].state == ${P}RETESTED)
         {
            if(barLo < ${P}zones[_k].retestLow) ${P}zones[_k].retestLow = barLo;
            // CONFIRMED: close above upper wick after retest
            if(barCl > hi)
            {
               ${P}zones[_k].state         = ${P}CONFIRMED;
               ${P}zones[_k].justConfirmed = true;
               ${P}zones[_k].confirmSL     = ${P}zones[_k].retestLow;
               ${P}_bullConfirmed          = true;
               ${P}_bullSL                 = ${P}zones[_k].retestLow;
               PrintFormat("[EGSM_${tf}] %s BULL CONFIRMED | hi=%.5f SL=%.5f",
                           ${P}zones[_k].isEF?"EF":"EG", hi, ${P}zones[_k].retestLow);
            }
         }
         // Re-entry after CONFIRMED: back to RETESTED (zone can confirm again)
         if(${P}zones[_k].state == ${P}CONFIRMED && barLo <= hi)
         { ${P}zones[_k].state = ${P}RETESTED; ${P}zones[_k].retestLow = barLo; }
      }
      else  // ── BEAR zone (EG or Bear EF) ────────────────────────────────────
      {
         // EG only: if original EG and price closes above hi → zone failed → Bull EF
         if(!${P}zones[_k].isEF && barCl > hi)
         {
            ${P}zones[_k].dir        = 1;
            ${P}zones[_k].isEF       = true;
            ${P}zones[_k].state      = ${P}ACTIVE;
            ${P}zones[_k].barsAlive  = 0;
            ${P}zones[_k].retestHigh = 0.0;
            ${P}zones[_k].retestLow  = 1e10;
            PrintFormat("[EGSM_${tf}] BEAR EG FAILED → BULL EF | hi=%.5f lo=%.5f", hi, lo);
            continue;
         }
         // EF only: if the EF also fails (close < lo) → fully invalidated (deleted)
         if(${P}zones[_k].isEF && barCl < lo)
            { ${P}zones[_k].state = ${P}INVALIDATED;
              PrintFormat("[EGSM_${tf}] BULL EF BROKEN → deleted | hi=%.5f lo=%.5f", hi, lo);
              continue; }
         // ACTIVE → RETESTED: wick enters zone from below
         if(${P}zones[_k].state == ${P}ACTIVE && barHi >= lo)
         {
            ${P}zones[_k].state      = ${P}RETESTED;
            ${P}zones[_k].retestHigh = barHi;
            PrintFormat("[EGSM_${tf}] %s BEAR RETESTED | lo=%.5f retestHigh=%.5f",
                        ${P}zones[_k].isEF?"EF":"EG", lo, barHi);
         }
         if(${P}zones[_k].state == ${P}RETESTED)
         {
            if(barHi > ${P}zones[_k].retestHigh) ${P}zones[_k].retestHigh = barHi;
            // CONFIRMED: close below lower wick after retest
            if(barCl < lo)
            {
               ${P}zones[_k].state         = ${P}CONFIRMED;
               ${P}zones[_k].justConfirmed = true;
               ${P}zones[_k].confirmSL     = ${P}zones[_k].retestHigh;
               ${P}_bearConfirmed          = true;
               ${P}_bearSL                 = ${P}zones[_k].retestHigh;
               PrintFormat("[EGSM_${tf}] %s BEAR CONFIRMED | lo=%.5f SL=%.5f",
                           ${P}zones[_k].isEF?"EF":"EG", lo, ${P}zones[_k].retestHigh);
            }
         }
         // Re-entry after CONFIRMED: back to RETESTED
         if(${P}zones[_k].state == ${P}CONFIRMED && barHi >= lo)
         { ${P}zones[_k].state = ${P}RETESTED; ${P}zones[_k].retestHigh = barHi; }
      }
   }
}

// ── Main tick — call once per bar (assembler calls this, not AI wiring) ───────
void ${P}Tick(int lookback)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   for(int sh = lookback; sh >= 2; sh--) ${P}Detect(sh);
   ${P}Advance(1);
}

// ── Query functions ──────────────────────────────────────────────────────────
bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==1 && ${P}zones[_k].state<${P}MITIGATED) return true;
   return false;
}
bool ${P}HasActiveBear()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==-1 && ${P}zones[_k].state<${P}MITIGATED) return true;
   return false;
}
double ${P}LatestBullUL()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==1 && ${P}zones[_k].state<${P}MITIGATED)
         return ${P}zones[_k].hi;
   return 0.0;
}
double ${P}LatestBullLL()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==1 && ${P}zones[_k].state<${P}MITIGATED)
         return ${P}zones[_k].lo;
   return 0.0;
}
double ${P}LatestBearUL()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==-1 && ${P}zones[_k].state<${P}MITIGATED)
         return ${P}zones[_k].hi;
   return 0.0;
}
double ${P}LatestBearLL()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==-1 && ${P}zones[_k].state<${P}MITIGATED)
         return ${P}zones[_k].lo;
   return 0.0;
}
datetime ${P}LatestBullZoneTime()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==1 && ${P}zones[_k].state<${P}MITIGATED)
         return ${P}zones[_k].c1Time;
   return 0;
}
datetime ${P}LatestBearZoneTime()
{
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==-1 && ${P}zones[_k].state<${P}MITIGATED)
         return ${P}zones[_k].c1Time;
   return 0;
}
`;
}
