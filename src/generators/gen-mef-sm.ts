/**
 * Inline MEF (Manipulation Entry Formula) State Machine Generator
 *
 * MEF = strong engulfing (main TF) + Gap SNR (1 TF lower) + RBR/DBD (2 TF lower),
 * all inside the engulfing candle window.
 *
 * Standard API:
 *   MEFSM_{id}_Reset()
 *   MEFSM_{id}_Tick(lookback)
 *   MEFSM_{id}_BullJustConfirmed() / BearJustConfirmed()
 *   MEFSM_{id}_BullConfirmSL() / BearConfirmSL()
 *   MEFSM_{id}_HasActiveBull() / HasActiveBear()
 *   MEFSM_{id}_ActiveBullSL() / ActiveBearSL()
 */

export function genMefSM(
  id: string,
  mainTF: string,
  tf: string,
  gapTF: string,
  baseTF: string,
  lookback = 300,
  expiryBars = 150,
  impulseRatio = 0.5,
  baseMaxRatio = 0.5,
  maxBaseCandles = 6,
  legBaseMult = 1.3,
): string {
  const P = `MEFSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| MEF State Machine — ${tf} main (${id})                           |
//| Engulfing + Gap SNR + RBR/DBD confluence                        |
//+------------------------------------------------------------------+
#define ${P}DIR_BULL  1
#define ${P}DIR_BEAR -1

struct ${P}MefRec
{
   int      dir;
   double   engHi;
   double   engLo;
   datetime engTime;
   datetime engEnd;
   double   gapLevel;
   double   baseHi;
   double   baseLo;
   bool     dead;
   int      ageCounter;
};

#define ${P}MAX_MEF 120
${P}MefRec ${P}mefs[${P}MAX_MEF];
int       ${P}mefCount = 0;
bool      ${P}_bullConfirmed = false;
bool      ${P}_bearConfirmed = false;
double    ${P}_bullSL = 0.0;
double    ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}mefCount = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

double ${P}BR(ENUM_TIMEFRAMES _tf, int sh)
{
   double o = iOpen (InpSymbol, _tf, sh);
   double c = iClose(InpSymbol, _tf, sh);
   double r = iHigh (InpSymbol, _tf, sh) - iLow(InpSymbol, _tf, sh);
   if(r <= 0.0) return 0.0;
   return MathAbs(c - o) / r;
}
double ${P}RNG (ENUM_TIMEFRAMES _tf, int sh) { return iHigh(InpSymbol, _tf, sh) - iLow(InpSymbol, _tf, sh); }
bool   ${P}BULL(ENUM_TIMEFRAMES _tf, int sh) { return iClose(InpSymbol, _tf, sh) > iOpen(InpSymbol, _tf, sh); }
bool   ${P}BEAR(ENUM_TIMEFRAMES _tf, int sh) { return iClose(InpSymbol, _tf, sh) < iOpen(InpSymbol, _tf, sh); }
bool   ${P}STRONG(ENUM_TIMEFRAMES _tf, int sh) { return ${P}BR(_tf, sh) >= ${impulseRatio}; }
bool   ${P}SMALL (ENUM_TIMEFRAMES _tf, int sh) { return ${P}BR(_tf, sh) <= ${baseMaxRatio}; }

double ${P}FindGapSnr(int dir, datetime wStart, datetime wEnd, double pLo, double pHi)
{
   int shOld = iBarShift(InpSymbol, ${gapTF}, wStart);
   int shNew = iBarShift(InpSymbol, ${gapTF}, wEnd);
   if(shOld < 1) return 0.0;
   if(shNew < 0) shNew = 0;

   for(int a = shOld; a >= shNew + 1; a--)
   {
      int b = a - 1;
      if(b < 0) break;
      datetime tA = iTime(InpSymbol, ${gapTF}, a);
      datetime tB = iTime(InpSymbol, ${gapTF}, b);
      if(tA < wStart || tB > wEnd) continue;

      if(dir == ${P}DIR_BULL && ${P}BULL(${gapTF}, a) && ${P}BULL(${gapTF}, b)) {
         double lvl = iClose(InpSymbol, ${gapTF}, a);
         if(lvl >= pLo && lvl <= pHi) return lvl;
      }
      if(dir == ${P}DIR_BEAR && ${P}BEAR(${gapTF}, a) && ${P}BEAR(${gapTF}, b)) {
         double lvl = iClose(InpSymbol, ${gapTF}, a);
         if(lvl >= pLo && lvl <= pHi) return lvl;
      }
   }
   return 0.0;
}

bool ${P}FindRbrDbd(int dir, datetime wStart, datetime wEnd, double pLo, double pHi,
                double &outHi, double &outLo)
{
   int avail = iBars(InpSymbol, ${baseTF});
   int shOld = iBarShift(InpSymbol, ${baseTF}, wStart);
   int shNew = iBarShift(InpSymbol, ${baseTF}, wEnd);
   if(shOld < 0) return false;
   if(shNew < 0) shNew = 0;

   for(int b = shNew; b <= shOld; b++)
   {
      if(b + 2 >= avail) continue;
      datetime tb = iTime(InpSymbol, ${baseTF}, b);
      if(tb < wStart || tb > wEnd) continue;

      if(!${P}STRONG(${baseTF}, b)) continue;
      if(dir == ${P}DIR_BULL && !${P}BULL(${baseTF}, b)) continue;
      if(dir == ${P}DIR_BEAR && !${P}BEAR(${baseTF}, b)) continue;

      int baseLen = 0;
      while(baseLen < ${maxBaseCandles}
            && (b + 1 + baseLen) < avail
            && ${P}SMALL(${baseTF}, b + 1 + baseLen))
         baseLen++;
      if(baseLen < 1) continue;

      int legIn = b + 1 + baseLen;
      if(legIn >= avail) continue;
      if(!${P}STRONG(${baseTF}, legIn)) continue;
      if(dir == ${P}DIR_BULL && !${P}BULL(${baseTF}, legIn)) continue;
      if(dir == ${P}DIR_BEAR && !${P}BEAR(${baseTF}, legIn)) continue;

      double bHi = -1.0, bLo = 1e18, sumR = 0.0;
      for(int k = 0; k < baseLen; k++) {
         int bb = b + 1 + k;
         double h = iHigh(InpSymbol, ${baseTF}, bb);
         double l = iLow (InpSymbol, ${baseTF}, bb);
         if(h > bHi) bHi = h;
         if(l < bLo) bLo = l;
         sumR += (h - l);
      }
      double avgR = sumR / baseLen;
      if(avgR <= 0.0) continue;
      if(${P}RNG(${baseTF}, b)     < ${legBaseMult} * avgR) continue;
      if(${P}RNG(${baseTF}, legIn) < ${legBaseMult} * avgR) continue;

      double lc = iClose(InpSymbol, ${baseTF}, b);
      if(dir == ${P}DIR_BULL && lc <= bHi) continue;
      if(dir == ${P}DIR_BEAR && lc >= bLo) continue;
      if(bLo < pLo || bHi > pHi) continue;

      outHi = bHi; outLo = bLo;
      return true;
   }
   return false;
}

void ${P}DetectMef(int s)
{
   int avail = iBars(InpSymbol, ${mainTF});
   if(s + 1 >= avail) return;

   double c2c = iClose(InpSymbol, ${mainTF}, s);
   double c2o = iOpen (InpSymbol, ${mainTF}, s);
   double c2h = iHigh (InpSymbol, ${mainTF}, s);
   double c2l = iLow  (InpSymbol, ${mainTF}, s);
   double c1c = iClose(InpSymbol, ${mainTF}, s + 1);
   double c1o = iOpen (InpSymbol, ${mainTF}, s + 1);
   double c1h = iHigh (InpSymbol, ${mainTF}, s + 1);
   double c1l = iLow  (InpSymbol, ${mainTF}, s + 1);

   bool isBull = (c1c < c1o) && (c2c > c2o) && (c2c > c1h);
   bool isBear = (c1c > c1o) && (c2c < c2o) && (c2c < c1l);
   if(!isBull && !isBear) return;
   int dir = isBull ? ${P}DIR_BULL : ${P}DIR_BEAR;

   datetime engTime = iTime(InpSymbol, ${mainTF}, s + 1);
   datetime engEnd  = iTime(InpSymbol, ${mainTF}, s) + PeriodSeconds(${mainTF});
   double   pHi     = MathMax(c1h, c2h);
   double   pLo     = MathMin(c1l, c2l);

   for(int _k = 0; _k < ${P}mefCount; _k++)
      if(!${P}mefs[_k].dead && ${P}mefs[_k].engTime == engTime) return;

   double gapLevel = ${P}FindGapSnr(dir, engTime, engEnd, pLo, pHi);
   if(gapLevel == 0.0) return;

   double baseHi = 0.0, baseLo = 0.0;
   if(!${P}FindRbrDbd(dir, engTime, engEnd, pLo, pHi, baseHi, baseLo)) return;

   int idx = -1;
   for(int _k = 0; _k < ${P}mefCount; _k++)
      if(${P}mefs[_k].dead) { idx = _k; break; }
   if(idx < 0 && ${P}mefCount < ${P}MAX_MEF) idx = ${P}mefCount++;
   if(idx < 0) return;

   ${P}mefs[idx].dir        = dir;
   ${P}mefs[idx].engHi      = c2h;
   ${P}mefs[idx].engLo      = c2l;
   ${P}mefs[idx].engTime    = engTime;
   ${P}mefs[idx].engEnd     = engEnd;
   ${P}mefs[idx].gapLevel   = gapLevel;
   ${P}mefs[idx].baseHi     = baseHi;
   ${P}mefs[idx].baseLo     = baseLo;
   ${P}mefs[idx].dead       = false;
   ${P}mefs[idx].ageCounter = 0;

   if(s == 1) {
      if(dir == ${P}DIR_BULL) {
         ${P}_bullConfirmed = true;
         ${P}_bullSL = c2l;
      } else {
         ${P}_bearConfirmed = true;
         ${P}_bearSL = c2h;
      }
   }
}

void ${P}Maintain(int s)
{
   datetime t = iTime(InpSymbol, ${mainTF}, s);
   for(int i = 0; i < ${P}mefCount; i++) {
      if(${P}mefs[i].dead) continue;
      if(${P}mefs[i].engEnd >= t) continue;
      ${P}mefs[i].ageCounter++;
      if(${P}mefs[i].ageCounter >= ${expiryBars}) ${P}mefs[i].dead = true;
   }
}

void ${P}Tick(int scanBars)
{
   ${P}Reset();
   int scan = (int)MathMin((long)scanBars, (long)(iBars(InpSymbol, ${mainTF}) - 2));
   if(scan < 2) return;
   for(int s = scan; s >= 1; s--) {
      ${P}DetectMef(s);
      ${P}Maintain(s);
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int i = ${P}mefCount - 1; i >= 0; i--)
      if(!${P}mefs[i].dead && ${P}mefs[i].dir == ${P}DIR_BULL) return true;
   return false;
}

bool ${P}HasActiveBear()
{
   for(int i = ${P}mefCount - 1; i >= 0; i--)
      if(!${P}mefs[i].dead && ${P}mefs[i].dir == ${P}DIR_BEAR) return true;
   return false;
}

double ${P}ActiveBullSL()
{
   for(int i = ${P}mefCount - 1; i >= 0; i--)
      if(!${P}mefs[i].dead && ${P}mefs[i].dir == ${P}DIR_BULL) return ${P}mefs[i].engLo;
   return 0.0;
}

double ${P}ActiveBearSL()
{
   for(int i = ${P}mefCount - 1; i >= 0; i--)
      if(!${P}mefs[i].dead && ${P}mefs[i].dir == ${P}DIR_BEAR) return ${P}mefs[i].engHi;
   return 0.0;
}
`;
}
