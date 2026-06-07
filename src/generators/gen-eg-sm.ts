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
  TF: string, // MQL5 PERIOD constant e.g. "PERIOD_M5"
  tf: string, // Human-readable label e.g. "M5"
  scanBack = 3, // bars to scan back for new completing candles each tick
  expiryBars = 100, // bars until an untested zone expires
  maxEngBars = 20, // max candles an engulf may take to complete (multi-candle)
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
   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      string _rn = StringFormat("4B_EG_${tf}_%d", (int)${P}zones[_k].c1Time);
      ObjectDelete(0, _rn);
      ObjectDelete(0, _rn + "_L");
   }
   ${P}zoneCount      = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL        = 0.0;
   ${P}_bearSL        = 0.0;
}

// ── Register a confirmed EG zone (engulfed candle c1, completed at c2) ────────
void ${P}AddZone(int c1, int c2, bool isBull, double c1H, double c1L, datetime c1T)
{
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

   ${P}zones[idx].dir           = isBull ? 1 : -1;
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

   PrintFormat("[EGSM_${tf}] %s EG detected | hi=%.5f lo=%.5f | took %d candle(s) | C1=%s",
               isBull?"BULL":"BEAR", c1H, c1L, (c1 - c2),
               TimeToString(c1T, TIME_DATE|TIME_MINUTES));
}

// ── Detect EG completed at bar c2 (multi-candle aware) ───────────────────────
// MES rule: an engulfing is a candle whose OPPOSITE wick is closed through, no
// matter how many candles it takes. Treat c2 as the completing candle; scan back
// to the NEAREST prior candle C1 whose opposite wick c2 just closed beyond, and
// require c2 to be the FIRST bar to break it (so each event fires once).
void ${P}Detect(int c2)
{
   int total = iBars(InpSymbol, ${TF});
   if(c2 + 1 >= total) return;

   double c2O = iOpen (InpSymbol, ${TF}, c2);
   double c2C = iClose(InpSymbol, ${TF}, c2);

   int maxBack = ${maxEngBars};

   for(int k = 1; k <= maxBack; k++)
   {
      int c1 = c2 + k;
      if(c1 >= total) break;

      double c1O = iOpen (InpSymbol, ${TF}, c1);
      double c1C = iClose(InpSymbol, ${TF}, c1);
      double c1H = iHigh (InpSymbol, ${TF}, c1);
      double c1L = iLow  (InpSymbol, ${TF}, c1);
      datetime c1T = iTime(InpSymbol, ${TF}, c1);

      bool c1Bear = (c1C < c1O);
      bool c1Bull = (c1C > c1O);

      // Bullish EG: bearish C1, completing candle bullish & closes ABOVE C1 upper wick
      bool isBullEG = c1Bear && (c2C > c2O) && (c2C > c1H);
      // Bearish EG: bullish C1, completing candle bearish & closes BELOW C1 lower wick
      bool isBearEG = c1Bull && (c2C < c2O) && (c2C < c1L);
      if(!isBullEG && !isBearEG) continue;

      // c2 must be the FIRST bar after C1 to close beyond that wick
      bool firstBreak = true;
      for(int m = c1 - 1; m > c2; m--)
      {
         double mc = iClose(InpSymbol, ${TF}, m);
         if(isBullEG && mc > c1H) { firstBreak = false; break; }
         if(isBearEG && mc < c1L) { firstBreak = false; break; }
      }
      if(!firstBreak) continue;

      ${P}AddZone(c1, c2, isBullEG, c1H, c1L, c1T);
      return;  // nearest qualifying C1 only — one engulfing per completing candle
   }
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
   // ── Chart visualization: rectangle per EG/EF zone ───────────────
   datetime _t2 = iTime(InpSymbol, PERIOD_CURRENT, 0) + PeriodSeconds(${TF}) * 5;
   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      string _rn = StringFormat("4B_EG_${tf}_%d", (int)${P}zones[_k].c1Time);
      string _ln = _rn + "_L";
      if(${P}zones[_k].state >= ${P}MITIGATED)
      {
         ObjectDelete(0, _rn);
         ObjectDelete(0, _ln);
         continue;
      }
      color _col = ${P}zones[_k].state == ${P}RETESTED  ? clrGold
                 : ${P}zones[_k].state == ${P}CONFIRMED  ? clrDimGray
                 : ${P}zones[_k].dir   == 1              ? clrMediumOrchid
                 :                                         clrPeru;
      if(ObjectFind(0, _rn) < 0)
         ObjectCreate(0, _rn, OBJ_RECTANGLE, 0, ${P}zones[_k].c1Time, ${P}zones[_k].hi, _t2, ${P}zones[_k].lo);
      ObjectSetInteger(0, _rn, OBJPROP_TIME,       1, _t2);
      ObjectSetInteger(0, _rn, OBJPROP_COLOR,         _col);
      ObjectSetInteger(0, _rn, OBJPROP_STYLE,         STYLE_SOLID);
      ObjectSetInteger(0, _rn, OBJPROP_WIDTH,         1);
      ObjectSetInteger(0, _rn, OBJPROP_BACK,          true);
      ObjectSetInteger(0, _rn, OBJPROP_FILL,          true);
      ObjectSetInteger(0, _rn, OBJPROP_SELECTABLE,    false);
      string _stxt = ${P}zones[_k].isEF ? (${P}zones[_k].dir==1?"EF+":"EF-")
                   : (${P}zones[_k].dir==1 ? "EG+" : "EG-");
      double _mid  = (${P}zones[_k].hi + ${P}zones[_k].lo) * 0.5;
      if(ObjectFind(0, _ln) < 0)
         ObjectCreate(0, _ln, OBJ_TEXT, 0, ${P}zones[_k].c1Time, _mid);
      ObjectSetString (0, _ln, OBJPROP_TEXT,        _stxt);
      ObjectSetInteger(0, _ln, OBJPROP_COLOR,       _col);
      ObjectSetInteger(0, _ln, OBJPROP_FONTSIZE,    7);
      ObjectSetInteger(0, _ln, OBJPROP_SELECTABLE,  false);
   }
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

// ── Roadblock detection (MES) ─────────────────────────────────────────────────
// An opposing live EG/EF zone sitting in the path of a move can halt price.
// A BULL move is roadblocked by an active BEAR zone ABOVE current price.
// A BEAR move is roadblocked by an active BULL zone BELOW current price.
// Returns the near edge of the nearest blocking zone, or 0.0 if the path is clear.
double ${P}RoadblockBull()
{
   double _px   = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   double _best = 0.0;
   for(int _k=0;_k<${P}zoneCount;_k++)
   {
      if(${P}zones[_k].dir != -1 || ${P}zones[_k].state >= ${P}MITIGATED) continue;
      if(${P}zones[_k].lo <= _px) continue;                 // not ahead (above price)
      if(_best == 0.0 || ${P}zones[_k].lo < _best) _best = ${P}zones[_k].lo;
   }
   return _best;   // nearest bear-zone lower edge above price (0 = clear)
}
double ${P}RoadblockBear()
{
   double _px   = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   double _best = 0.0;
   for(int _k=0;_k<${P}zoneCount;_k++)
   {
      if(${P}zones[_k].dir != 1 || ${P}zones[_k].state >= ${P}MITIGATED) continue;
      if(${P}zones[_k].hi >= _px) continue;                 // not ahead (below price)
      if(_best == 0.0 || ${P}zones[_k].hi > _best) _best = ${P}zones[_k].hi;
   }
   return _best;   // nearest bull-zone upper edge below price (0 = clear)
}
bool ${P}PathClearBull() { return ${P}RoadblockBull() == 0.0; }
bool ${P}PathClearBear() { return ${P}RoadblockBear() == 0.0; }
`;
}
