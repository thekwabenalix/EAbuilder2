/**
 * Inline BOS / CHoCH State Machine Generator
 *
 * Detects swing highs/lows, tracks Break-of-Structure and Change-of-Character.
 * Maintains a persistent trend bias (BULL / BEAR / UNKNOWN).
 *
 * Standard API:
 *   BOSSM_{id}_Reset()
 *   BOSSM_{id}_Tick(lookback)          — call once per bar-open
 *   BOSSM_{id}_IsBull()                — trend is currently BULL
 *   BOSSM_{id}_IsBear()                — trend is currently BEAR
 *   BOSSM_{id}_BullJustBroke()         — BOS/CHoCH BULL fired this bar
 *   BOSSM_{id}_BearJustBroke()         — BOS/CHoCH BEAR fired this bar
 */

export type BosSmMode = "bos" | "choch" | "both";

export function genBosSM(
  id: string,
  TF: string,
  tf: string,
  mode: BosSmMode = "bos",
  swingLen = 5, // pivot confirmation bars each side
  lookback = 20, // bars to scan for swing levels
): string {
  const P = `BOSSM_${id}_`;
  const modeLabel = mode === "bos" ? "BOS" : mode === "choch" ? "CHoCH" : "BOS+CHoCH";

  return `
//+------------------------------------------------------------------+
//| ${modeLabel} State Machine — ${tf} (${id})                     |
//| Persistent trend bias: 1=BULL, -1=BEAR, 0=UNKNOWN              |
//+------------------------------------------------------------------+
struct ${P}SwingRec
{
   int      dir;         //  1=high  -1=low
   double   price;
   datetime barTime;
   bool     consumed;
};

#define ${P}MAX_SWINGS 100

${P}SwingRec ${P}swings[${P}MAX_SWINGS];
int  ${P}swingCount   = 0;
int  ${P}trend        = 0;   //  1=BULL  -1=BEAR  0=UNKNOWN
bool ${P}_bullBroke   = false;
bool ${P}_bearBroke   = false;

void ${P}Reset()
{
   for(int _oi = ObjectsTotal(0) - 1; _oi >= 0; _oi--)
   {
      string _on = ObjectName(0, _oi);
      if(StringFind(_on, "4B_BOS_${tf}_") == 0) ObjectDelete(0, _on);
   }
   ${P}swingCount = 0;
   ${P}trend      = 0;
   ${P}_bullBroke = false;
   ${P}_bearBroke = false;
}

// ── Detect pivot at bar sh ───────────────────────────────────────────
void ${P}DetectPivot(int sh, int totalBars)
{
   if(sh + ${swingLen} >= totalBars || sh - ${swingLen} < 0) return;
   datetime t = iTime(InpSymbol, ${TF}, sh);
   for(int _k = 0; _k < ${P}swingCount; _k++)
      if(${P}swings[_k].barTime == t) return;  // dedup

   double hi = iHigh(InpSymbol, ${TF}, sh);
   double lo = iLow (InpSymbol, ${TF}, sh);
   bool isHigh = true, isLow = true;
   for(int _j = sh - ${swingLen}; _j <= sh + ${swingLen}; _j++)
   {
      if(_j == sh) continue;
      if(iHigh(InpSymbol, ${TF}, _j) >= hi) isHigh = false;
      if(iLow (InpSymbol, ${TF}, _j) <= lo) isLow  = false;
   }
   if(!isHigh && !isLow) return;

   // add swing
   if(${P}swingCount >= ${P}MAX_SWINGS)
   {
      // prune oldest consumed swing
      for(int _k = 0; _k < ${P}swingCount - 1; _k++) ${P}swings[_k] = ${P}swings[_k+1];
      ${P}swingCount--;
   }
   ${P}swings[${P}swingCount].dir      = isHigh ? 1 : -1;
   ${P}swings[${P}swingCount].price    = isHigh ? hi : lo;
   ${P}swings[${P}swingCount].barTime  = t;
   ${P}swings[${P}swingCount].consumed = false;
   ${P}swingCount++;
}

// ── Check for structure break at bar 1 ──────────────────────────────
void ${P}CheckBreak()
{
   double cl = iClose(InpSymbol, ${TF}, 1);

   for(int _k = 0; _k < ${P}swingCount; _k++)
   {
      if(${P}swings[_k].consumed) continue;
      if(${P}swings[_k].dir == 1)   // swing HIGH
      {
         if(cl > ${P}swings[_k].price)
         {
            ${P}swings[_k].consumed = true;
${
  mode === "choch"
    ? `
            // CHoCH: only fire if trend was BEAR (reversal signal)
            if(${P}trend <= 0)
            {
               ${P}_bullBroke = true;
               ${P}trend = 1;
               PrintFormat("[${modeLabel}_${tf}] BULL CHoCH level=%.5f", ${P}swings[_k].price);
            }`
    : mode === "bos"
      ? `
            // BOS: fire on with-trend continuation OR first break
            ${P}_bullBroke = true;
            ${P}trend = 1;
            PrintFormat("[${modeLabel}_${tf}] BULL BOS level=%.5f", ${P}swings[_k].price);`
      : `
            // BOS+CHoCH: fire on any upside break
            ${P}_bullBroke = true;
            ${P}trend = 1;
            PrintFormat("[${modeLabel}_${tf}] BULL break level=%.5f", ${P}swings[_k].price);`
}
         }
      }
      else  // swing LOW
      {
         if(cl < ${P}swings[_k].price)
         {
            ${P}swings[_k].consumed = true;
${
  mode === "choch"
    ? `
            if(${P}trend >= 0)
            {
               ${P}_bearBroke = true;
               ${P}trend = -1;
               PrintFormat("[${modeLabel}_${tf}] BEAR CHoCH level=%.5f", ${P}swings[_k].price);
            }`
    : mode === "bos"
      ? `
            ${P}_bearBroke = true;
            ${P}trend = -1;
            PrintFormat("[${modeLabel}_${tf}] BEAR BOS level=%.5f", ${P}swings[_k].price);`
      : `
            ${P}_bearBroke = true;
            ${P}trend = -1;
            PrintFormat("[${modeLabel}_${tf}] BEAR break level=%.5f", ${P}swings[_k].price);`
}
         }
      }
   }
}

void ${P}Tick(int lb)
{
   ${P}_bullBroke = false;
   ${P}_bearBroke = false;
   int total = iBars(InpSymbol, ${TF});
   for(int sh = lb + ${swingLen}; sh >= ${swingLen} + 1; sh--)
      ${P}DetectPivot(sh, total);
   ${P}CheckBreak();
   // ── Chart visualization: arrow at break bar ──────────────────────
   if(${P}_bullBroke || ${P}_bearBroke)
   {
      datetime _bt = iTime(InpSymbol, ${TF}, 1);
      string   _an = StringFormat("4B_BOS_${tf}_%d", (int)_bt);
      if(ObjectFind(0, _an) < 0)
      {
         if(${P}_bullBroke)
         {
            double _price = iLow(InpSymbol, ${TF}, 1);
            ObjectCreate(0, _an, OBJ_ARROW, 0, _bt, _price);
            ObjectSetInteger(0, _an, OBJPROP_ARROWCODE,  233);
            ObjectSetInteger(0, _an, OBJPROP_COLOR,      clrDodgerBlue);
            ObjectSetInteger(0, _an, OBJPROP_ANCHOR,     ANCHOR_TOP);
         }
         else
         {
            double _price = iHigh(InpSymbol, ${TF}, 1);
            ObjectCreate(0, _an, OBJ_ARROW, 0, _bt, _price);
            ObjectSetInteger(0, _an, OBJPROP_ARROWCODE,  234);
            ObjectSetInteger(0, _an, OBJPROP_COLOR,      clrOrangeRed);
            ObjectSetInteger(0, _an, OBJPROP_ANCHOR,     ANCHOR_BOTTOM);
         }
         ObjectSetInteger(0, _an, OBJPROP_WIDTH,      2);
         ObjectSetInteger(0, _an, OBJPROP_SELECTABLE, false);
      }
   }
}

bool ${P}IsBull()       { return ${P}trend ==  1; }
bool ${P}IsBear()       { return ${P}trend == -1; }
bool ${P}BullJustBroke(){ return ${P}_bullBroke; }
bool ${P}BearJustBroke(){ return ${P}_bearBroke; }
int  ${P}Trend()        { return ${P}trend; }
`;
}
