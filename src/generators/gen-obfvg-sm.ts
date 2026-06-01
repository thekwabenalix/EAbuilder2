/**
 * Inline OB+FVG State Machine Generator
 *
 * Source of truth: src/lib/smc-modules/ob-fvg-detector.ts (verified reference).
 * This embeds the SAME detection inline so the assembled EA is self-contained
 * (no iCustom, no separate indicator).
 *
 * OB+FVG = a 3-candle Fair Value Gap whose FIRST candle is the opposite colour
 * to the gap. That first candle IS the order block; entry is at the OB body.
 *   Bullish: high(C1) < low(C3) (bullish gap) AND C1 bearish.
 *   Bearish: low(C1)  > high(C3) (bearish gap) AND C1 bullish.
 *
 * FRESH zones only — a zone is consumed the instant price tests the OB body.
 *
 * Standard API:
 *   OBFVGSM_{id}_Reset()
 *   OBFVGSM_{id}_Tick(lookback)
 *   OBFVGSM_{id}_HasActiveBull() / HasActiveBear()   — a fresh OB+FVG zone exists (SETUP)
 *   OBFVGSM_{id}_BullJustConfirmed() / BearJustConfirmed() — price tapped the OB body (ENTRY)
 *   OBFVGSM_{id}_BullConfirmSL() / BearConfirmSL()   — OB invalidation level (SL)
 *   OBFVGSM_{id}_ActiveBullSL() / ActiveBearSL()     — freshest zone's OB low/high (setup SL hint)
 */

export function genObFvgSM(
  id: string,
  TF: string,
  tf: string,
  expiryBars = 250,
): string {
  const P = `OBFVGSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| OB+FVG State Machine — ${tf} (${id})                            |
//| FVG whose first candle is the opposite colour = the OB.        |
//| Entry at the OB body. Fresh zones only.                        |
//+------------------------------------------------------------------+
struct ${P}Zone
{
   int      dir;        //  1=bullish  -1=bearish
   double   obTop;      // OB (C1) body top
   double   obBot;      // OB (C1) body bottom (entry zone)
   double   obLo;       // C1 low  (SL ref)
   double   obHi;       // C1 high (SL ref)
   datetime obTime;     // C1 time (dedup key)
   datetime confirmTime;// C3 time — valid only after this
   bool     dead;
   int      barsAlive;
};

#define ${P}MAX_ZONES 120
${P}Zone ${P}zones[${P}MAX_ZONES];
int    ${P}zoneCount = 0;
bool   ${P}_bullConfirmed = false;
bool   ${P}_bearConfirmed = false;
double ${P}_bullSL = 0.0;
double ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}zoneCount = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

// Was this fresh zone already tested between its C3 and bar 1? (back-fill guard)
bool ${P}AlreadyTested(int dir, double obTop, double obBot, int c3Shift)
{
   for(int _k = c3Shift - 1; _k >= 1; _k--)
   {
      if(dir == 1  && iLow (InpSymbol, ${TF}, _k) <= obTop) return true;
      if(dir == -1 && iHigh(InpSymbol, ${TF}, _k) >= obBot) return true;
   }
   return false;
}

void ${P}AddZone(int dir, double obTop, double obBot, double obLo, double obHi,
                 datetime obT, datetime confT, int c3Shift)
{
   for(int _k = 0; _k < ${P}zoneCount; _k++)
      if(${P}zones[_k].obTime == obT && ${P}zones[_k].dir == dir) return;     // dedup
   if(${P}AlreadyTested(dir, obTop, obBot, c3Shift)) return;                  // not fresh
   int idx = -1;
   for(int _k = 0; _k < ${P}zoneCount; _k++)
      if(${P}zones[_k].dead) { idx = _k; break; }
   if(idx < 0) {
      if(${P}zoneCount >= ${P}MAX_ZONES) return;
      idx = ${P}zoneCount++;
   }
   ${P}zones[idx].dir         = dir;
   ${P}zones[idx].obTop       = obTop;
   ${P}zones[idx].obBot       = obBot;
   ${P}zones[idx].obLo        = obLo;
   ${P}zones[idx].obHi        = obHi;
   ${P}zones[idx].obTime      = obT;
   ${P}zones[idx].confirmTime = confT;
   ${P}zones[idx].dead        = false;
   ${P}zones[idx].barsAlive   = 0;
}

// Detect an OB+FVG at C3 = sh (C2 = sh+1, C1 = sh+2).
void ${P}Detect(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + 2 >= total) return;
   double c1o = iOpen (InpSymbol, ${TF}, sh + 2);
   double c1c = iClose(InpSymbol, ${TF}, sh + 2);
   double c1h = iHigh (InpSymbol, ${TF}, sh + 2);
   double c1l = iLow  (InpSymbol, ${TF}, sh + 2);
   double c3h = iHigh (InpSymbol, ${TF}, sh);
   double c3l = iLow  (InpSymbol, ${TF}, sh);
   datetime t1 = iTime(InpSymbol, ${TF}, sh + 2);
   datetime t3 = iTime(InpSymbol, ${TF}, sh);
   bool c1Bear = (c1c < c1o), c1Bull = (c1c > c1o);
   // Bullish OB+FVG: bullish gap with a bearish first candle
   if(c1h < c3l && c1Bear) ${P}AddZone( 1, c1o, c1c, c1l, c1h, t1, t3, sh);
   // Bearish OB+FVG: bearish gap with a bullish first candle
   if(c1l > c3h && c1Bull) ${P}AddZone(-1, c1c, c1o, c1l, c1h, t1, t3, sh);
}

// Price tapped a fresh OB body on the just-closed bar → entry, consume zone.
void ${P}CheckTaps()
{
   double lo = iLow (InpSymbol, ${TF}, 1);
   double hi = iHigh(InpSymbol, ${TF}, 1);
   datetime t = iTime(InpSymbol, ${TF}, 1);
   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      if(${P}zones[_k].dead) continue;
      if(t <= ${P}zones[_k].confirmTime) continue;
      if(${P}zones[_k].dir == 1 && lo <= ${P}zones[_k].obTop)
      {
         ${P}_bullConfirmed = true;
         ${P}_bullSL        = ${P}zones[_k].obLo;
         ${P}zones[_k].dead = true;
         PrintFormat("[OBFVGSM_${tf}] BULL entry: tapped OB body top=%.5f SL=%.5f", ${P}zones[_k].obTop, ${P}zones[_k].obLo);
      }
      else if(${P}zones[_k].dir == -1 && hi >= ${P}zones[_k].obBot)
      {
         ${P}_bearConfirmed = true;
         ${P}_bearSL        = ${P}zones[_k].obHi;
         ${P}zones[_k].dead = true;
         PrintFormat("[OBFVGSM_${tf}] BEAR entry: tapped OB body bot=%.5f SL=%.5f", ${P}zones[_k].obBot, ${P}zones[_k].obHi);
      }
   }
}

void ${P}Tick(int lookback)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   for(int sh = lookback; sh >= 1; sh--) ${P}Detect(sh);
   ${P}CheckTaps();
   for(int _k = 0; _k < ${P}zoneCount; _k++)
   {
      if(${P}zones[_k].dead) continue;
      ${P}zones[_k].barsAlive++;
      if(${P}zones[_k].barsAlive >= ${expiryBars}) ${P}zones[_k].dead = true;
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }
bool   ${P}HasActiveBull()
{
   for(int _k=0;_k<${P}zoneCount;_k++) if(${P}zones[_k].dir==1 && !${P}zones[_k].dead) return true;
   return false;
}
bool   ${P}HasActiveBear()
{
   for(int _k=0;_k<${P}zoneCount;_k++) if(${P}zones[_k].dir==-1 && !${P}zones[_k].dead) return true;
   return false;
}
// Freshest (most recent) live zone's OB invalidation level — setup SL hint.
double ${P}ActiveBullSL()
{
   double sl = 0.0; datetime best = 0;
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==1 && !${P}zones[_k].dead && ${P}zones[_k].confirmTime >= best)
         { best = ${P}zones[_k].confirmTime; sl = ${P}zones[_k].obLo; }
   return sl;
}
double ${P}ActiveBearSL()
{
   double sl = 0.0; datetime best = 0;
   for(int _k=0;_k<${P}zoneCount;_k++)
      if(${P}zones[_k].dir==-1 && !${P}zones[_k].dead && ${P}zones[_k].confirmTime >= best)
         { best = ${P}zones[_k].confirmTime; sl = ${P}zones[_k].obHi; }
   return sl;
}
`;
}
