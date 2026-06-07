/**
 * Inline Rejection State Machine Generator
 *
 * Playbook definition (Reactive/Malaysian SNR, Rule 2):
 *   "A rejection is a candle that closes below a resistance or above a support."
 *   The wick pierces the level, but the candle CLOSES BACK on the origin side —
 *   confirming the level held.
 *
 * This SM embeds S/R level detection (Classic reversal pairs + Gap continuation
 * pairs) and fires a confirmation when a strong-wick candle rejects from a level:
 *   Bullish rejection (off SUPPORT):  Low pierces the support, Close stays above.
 *   Bearish rejection (off RESISTANCE): High pierces the resistance, Close stays below.
 *
 * A minimum wick ratio filters weak touches (a real rejection has a long wick).
 *
 * Standard API:
 *   REJSM_{id}_Reset()
 *   REJSM_{id}_Tick(lookback)
 *   REJSM_{id}_BullJustConfirmed()  — bullish rejection off support this bar
 *   REJSM_{id}_BearJustConfirmed()  — bearish rejection off resistance this bar
 *   REJSM_{id}_BullConfirmSL()      — wick low of the rejection candle
 *   REJSM_{id}_BearConfirmSL()      — wick high of the rejection candle
 *   REJSM_{id}_HasActiveBull()      — a live support level exists
 *   REJSM_{id}_HasActiveBear()      — a live resistance level exists
 */

export function genRejectionSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 30, // bars scanned for S/R levels each tick
  minWickRatio = 0.5, // rejection wick must be >= this fraction of candle range
  expiryBars = 150,
): string {
  const P = `REJSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Rejection State Machine — ${tf} (${id})                         |
//| Wick pierces level + close back on origin side = rejection      |
//| Levels: Classic (reversal pair) + Gap (continuation pair)       |
//+------------------------------------------------------------------+
struct ${P}LevelRec
{
   int      dir;         //  1=support  -1=resistance
   double   level;       // candle A close — the SNR price
   datetime levelTime;   // candle A time
   datetime confirmTime; // candle B time — SNR valid only AFTER this
   bool     broken;
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
      if(StringFind(_on, "4B_REJ_${tf}_") == 0) ObjectDelete(0, _on);
   }
   ${P}levelCount     = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

// ── Register a level (dedup by time, recycle broken slots) ────────────
void ${P}AddLevel(int dir, double level, datetime tA, datetime tB)
{
   for(int _k = 0; _k < ${P}levelCount; _k++)
      if(${P}levels[_k].levelTime == tA) return;
   int idx = -1;
   for(int _k = 0; _k < ${P}levelCount; _k++)
      if(${P}levels[_k].broken) { idx = _k; break; }
   if(idx < 0) {
      if(${P}levelCount >= ${P}MAX_LEVELS) return;
      idx = ${P}levelCount++;
   }
   ${P}levels[idx].dir         = dir;
   ${P}levels[idx].level       = level;
   ${P}levels[idx].levelTime   = tA;
   ${P}levels[idx].confirmTime = tB;   // candle B — valid only after this
   ${P}levels[idx].broken      = false;
   ${P}levels[idx].barsAlive   = 0;
}

// ── Detect Classic + Gap S/R levels from the candle pair at (sh+1, sh) ─
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

   // Classic SNR (reversal pair)
   if(aBull && bBear) ${P}AddLevel(-1, aC, tA, tB);  // resistance
   else if(aBear && bBull) ${P}AddLevel(1, aC, tA, tB);  // support
   // Gap SNR (continuation pair)
   else if(aBull && bBull) ${P}AddLevel(1, aC, tA, tB);  // gap support
   else if(aBear && bBear) ${P}AddLevel(-1, aC, tA, tB);  // gap resistance
}

// ── Check bar sh for a rejection off any live level ───────────────────
void ${P}CheckRejection(int sh)
{
   double o = iOpen (InpSymbol, ${TF}, sh);
   double c = iClose(InpSymbol, ${TF}, sh);
   double h = iHigh (InpSymbol, ${TF}, sh);
   double l = iLow  (InpSymbol, ${TF}, sh);
   double range = h - l;
   if(range <= 0) return;
   double lowerWick = MathMin(o, c) - l;
   double upperWick = h - MathMax(o, c);
   datetime bt = iTime(InpSymbol, ${TF}, sh);

   for(int _k = 0; _k < ${P}levelCount; _k++)
   {
      if(${P}levels[_k].broken) continue;
      // Rejection must be on a candle AFTER candle B (SNR not yet valid on B).
      if(bt <= ${P}levels[_k].confirmTime) continue;
      double lvl = ${P}levels[_k].level;

      if(${P}levels[_k].dir == 1)  // SUPPORT → look for bullish rejection
      {
         // Wick pierced support, close stayed above, long lower wick
         if(l <= lvl && c > lvl && lowerWick >= range * ${minWickRatio})
         {
            ${P}_bullConfirmed = true;
            ${P}_bullSL = l;
            PrintFormat("[REJSM_${tf}] BULL REJECTION off support=%.5f SL=%.5f", lvl, l);
         }
         // close below support = level broken
         if(c < lvl) ${P}levels[_k].broken = true;
      }
      else  // RESISTANCE → look for bearish rejection
      {
         if(h >= lvl && c < lvl && upperWick >= range * ${minWickRatio})
         {
            ${P}_bearConfirmed = true;
            ${P}_bearSL = h;
            PrintFormat("[REJSM_${tf}] BEAR REJECTION off resistance=%.5f SL=%.5f", lvl, h);
         }
         if(c > lvl) ${P}levels[_k].broken = true;
      }
   }
}

void ${P}Tick(int lookback)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   for(int sh = lookback; sh >= 1; sh--) ${P}Detect(sh);
   // age + expire
   for(int _k = 0; _k < ${P}levelCount; _k++)
   {
      if(${P}levels[_k].broken) continue;
      ${P}levels[_k].barsAlive++;
      if(${P}levels[_k].barsAlive >= ${expiryBars}) ${P}levels[_k].broken = true;
   }
   ${P}CheckRejection(1);
   // ── Chart visualization: level lines + arrow at signal bar ──────
   datetime _t2 = iTime(InpSymbol, PERIOD_CURRENT, 0) + PeriodSeconds(${TF}) * 20;
   for(int _k = 0; _k < ${P}levelCount; _k++)
   {
      string _ln = StringFormat("4B_REJ_${tf}_%d", (int)${P}levels[_k].levelTime);
      if(${P}levels[_k].broken) { ObjectDelete(0, _ln); continue; }
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
      string   _an = StringFormat("4B_REJ_${tf}_sig_%d", (int)_bt);
      if(ObjectFind(0, _an) < 0)
      {
         if(${P}_bullConfirmed)
         {
            ObjectCreate(0, _an, OBJ_ARROW, 0, _bt, iLow(InpSymbol, ${TF}, 1));
            ObjectSetInteger(0, _an, OBJPROP_ARROWCODE, 233);
            ObjectSetInteger(0, _an, OBJPROP_COLOR,     clrCornflowerBlue);
            ObjectSetInteger(0, _an, OBJPROP_ANCHOR,    ANCHOR_TOP);
         }
         else
         {
            ObjectCreate(0, _an, OBJ_ARROW, 0, _bt, iHigh(InpSymbol, ${TF}, 1));
            ObjectSetInteger(0, _an, OBJPROP_ARROWCODE, 234);
            ObjectSetInteger(0, _an, OBJPROP_COLOR,     clrSalmon);
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
      if(${P}levels[_k].dir==1 && !${P}levels[_k].broken) return true;
   return false;
}
bool   ${P}HasActiveBear()
{
   for(int _k=0;_k<${P}levelCount;_k++)
      if(${P}levels[_k].dir==-1 && !${P}levels[_k].broken) return true;
   return false;
}
`;
}
