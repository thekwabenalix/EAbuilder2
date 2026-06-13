/**
 * Inline Unicorn State Machine Generator (Breaker Block + FVG overlap)
 *
 * ICT Unicorn: a Breaker Block overlapping a same-direction FVG.
 * Entry pocket = price overlap of breaker zone and FVG gap.
 *
 * Standard API:
 *   UNISMSM_{id}_Reset()
 *   UNISMSM_{id}_Tick(lookback)
 *   UNISMSM_{id}_HasActiveBull() / HasActiveBear()   — live overlap pocket (SETUP)
 *   UNISMSM_{id}_BullJustRetested() / BearJustRetested() — wick into pocket (SETUP/CONFIRM)
 *   UNISMSM_{id}_BullJustConfirmed() / BearJustConfirmed() — close outside after retest (ZONE REJECTION)
 *   UNISMSM_{id}_BullConfirmSL() / BearConfirmSL()   — wick extreme at rejection (SL)
 *   UNISMSM_{id}_ActiveBullSL() / ActiveBearSL()     — setup SL hint (breaker invalidation)
 */

export function genUnicornSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 500,
  dispMult = 1.5,
  dispAtrPeriod = 14,
  obScanBack = 5,
  pairWindow = 15,
  obExpiry = 300,
  uniExpiry = 250,
): string {
  const P = `UNISMSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Unicorn State Machine — ${tf} (${id})                           |
//| Breaker Block overlapping same-direction FVG — overlap pocket. |
//+------------------------------------------------------------------+
#define ${P}PHASE_OB  0
#define ${P}PHASE_BB  1

struct ${P}ObRec
{
   int      phase;
   int      dir;
   double   hi;
   double   lo;
   datetime obTime;
   datetime confirmTime;
   datetime breakTime;
   bool     matched;
   bool     dead;
   int      obAge;
   int      uniAge;
   double   uTop;
   double   uBot;
};

struct ${P}FvgRec
{
   int      dir;
   double   top;
   double   bot;
   datetime confirmTime;
   bool     used;
};

struct ${P}UniRec
{
   int      dir;
   double   brkHi;
   double   brkLo;
   double   ovTop;
   double   ovBot;
   datetime matchTime;
   int      state;
   double   retestLow;
   double   retestHigh;
   bool     dead;
   int      barsAlive;
};

#define ${P}MAX_OBS 120
#define ${P}MAX_FVGS 120
#define ${P}MAX_UNI 120
${P}ObRec  ${P}obList[${P}MAX_OBS];
${P}FvgRec ${P}fvgList[${P}MAX_FVGS];
${P}UniRec ${P}uniList[${P}MAX_UNI];
int       ${P}obCount  = 0;
int       ${P}fvgCount = 0;
int       ${P}uniCount = 0;
bool      ${P}_bullConfirmed = false;
bool      ${P}_bearConfirmed = false;
bool      ${P}_bullJustRetested = false;
bool      ${P}_bearJustRetested = false;
double    ${P}_bullSL = 0.0;
double    ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}obCount  = 0;
   ${P}fvgCount = 0;
   ${P}uniCount = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullJustRetested = false;
   ${P}_bearJustRetested = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

double ${P}CalcATR(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + ${dispAtrPeriod} + 1 >= total) return 0.0;
   double sum = 0.0;
   for(int k = sh + 1; k <= sh + ${dispAtrPeriod}; k++)
   {
      double h = iHigh(InpSymbol, ${TF}, k);
      double l = iLow (InpSymbol, ${TF}, k);
      double pc = iClose(InpSymbol, ${TF}, k + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return sum / (double)${dispAtrPeriod};
}

void ${P}AddOb(int dir, double hi, double lo, datetime obT, datetime confT)
{
   for(int i = 0; i < ${P}obCount; i++)
      if(${P}obList[i].obTime == obT && !${P}obList[i].dead) return;
   int idx = -1;
   for(int i = 0; i < ${P}obCount; i++)
      if(${P}obList[i].dead) { idx = i; break; }
   if(idx < 0) {
      if(${P}obCount >= ${P}MAX_OBS) return;
      idx = ${P}obCount++;
   }
   ${P}obList[idx].phase       = ${P}PHASE_OB;
   ${P}obList[idx].dir         = dir;
   ${P}obList[idx].hi          = hi;
   ${P}obList[idx].lo          = lo;
   ${P}obList[idx].obTime      = obT;
   ${P}obList[idx].confirmTime = confT;
   ${P}obList[idx].breakTime   = 0;
   ${P}obList[idx].matched     = false;
   ${P}obList[idx].dead        = false;
   ${P}obList[idx].obAge       = 0;
   ${P}obList[idx].uniAge      = 0;
   ${P}obList[idx].uTop        = 0.0;
   ${P}obList[idx].uBot        = 0.0;
}

void ${P}AddFvg(int dir, double top, double bot, datetime confT)
{
   int idx = -1;
   for(int i = 0; i < ${P}fvgCount; i++)
      if(${P}fvgList[i].used) { idx = i; break; }
   if(idx < 0) {
      if(${P}fvgCount >= ${P}MAX_FVGS) return;
      idx = ${P}fvgCount++;
   }
   ${P}fvgList[idx].dir         = dir;
   ${P}fvgList[idx].top         = top;
   ${P}fvgList[idx].bot         = bot;
   ${P}fvgList[idx].confirmTime = confT;
   ${P}fvgList[idx].used        = false;
}

void ${P}AddUni(int dir, double brkHi, double brkLo, double ovTop, double ovBot, datetime matchT)
{
   int idx = -1;
   for(int i = 0; i < ${P}uniCount; i++)
      if(${P}uniList[i].dead) { idx = i; break; }
   if(idx < 0) {
      if(${P}uniCount >= ${P}MAX_UNI) return;
      idx = ${P}uniCount++;
   }
   ${P}uniList[idx].dir       = dir;
   ${P}uniList[idx].brkHi     = brkHi;
   ${P}uniList[idx].brkLo     = brkLo;
   ${P}uniList[idx].ovTop     = ovTop;
   ${P}uniList[idx].ovBot     = ovBot;
   ${P}uniList[idx].matchTime = matchT;
   ${P}uniList[idx].state     = 0;
   ${P}uniList[idx].retestLow = 0.0;
   ${P}uniList[idx].retestHigh = 0.0;
   ${P}uniList[idx].dead      = false;
   ${P}uniList[idx].barsAlive = 0;
}

void ${P}DetectOb(int sh)
{
   if(sh < 1) return;
   double atr = ${P}CalcATR(sh);
   if(atr <= 0.0) return;
   double dOpn = iOpen (InpSymbol, ${TF}, sh);
   double dCls = iClose(InpSymbol, ${TF}, sh);
   if(MathAbs(dCls - dOpn) < ${dispMult} * atr) return;
   int dispDir = (dCls > dOpn) ? 1 : -1;
   int total = iBars(InpSymbol, ${TF});
   int scanEnd = sh + ${obScanBack};
   if(scanEnd >= total - 1) scanEnd = total - 2;
   for(int j = sh + 1; j <= scanEnd; j++)
   {
      double jOpn = iOpen (InpSymbol, ${TF}, j);
      double jCls = iClose(InpSymbol, ${TF}, j);
      if(dispDir == 1 && jCls < jOpn) {
         ${P}AddOb(1, iHigh(InpSymbol, ${TF}, j), iLow(InpSymbol, ${TF}, j),
                   iTime(InpSymbol, ${TF}, j), iTime(InpSymbol, ${TF}, sh));
         return;
      }
      if(dispDir == -1 && jCls > jOpn) {
         ${P}AddOb(-1, iHigh(InpSymbol, ${TF}, j), iLow(InpSymbol, ${TF}, j),
                   iTime(InpSymbol, ${TF}, j), iTime(InpSymbol, ${TF}, sh));
         return;
      }
   }
}

void ${P}DetectFvg(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + 2 >= total) return;
   double c1h = iHigh(InpSymbol, ${TF}, sh + 2);
   double c1l = iLow (InpSymbol, ${TF}, sh + 2);
   double c3h = iHigh(InpSymbol, ${TF}, sh);
   double c3l = iLow (InpSymbol, ${TF}, sh);
   datetime t3 = iTime(InpSymbol, ${TF}, sh);
   if(c1h < c3l) ${P}AddFvg(1, c3l, c1h, t3);
   if(c1l > c3h) ${P}AddFvg(-1, c1l, c3h, t3);
}

void ${P}CheckBreaks(int sh)
{
   double cl = iClose(InpSymbol, ${TF}, sh);
   datetime t = iTime(InpSymbol, ${TF}, sh);
   for(int i = 0; i < ${P}obCount; i++)
   {
      if(${P}obList[i].dead || ${P}obList[i].phase != ${P}PHASE_OB) continue;
      if(${P}obList[i].confirmTime >= t) continue;
      if(${P}obList[i].dir == 1 && cl < ${P}obList[i].lo) {
         ${P}obList[i].phase     = ${P}PHASE_BB;
         ${P}obList[i].dir       = -1;
         ${P}obList[i].breakTime = t;
         ${P}obList[i].uniAge    = 0;
      }
      else if(${P}obList[i].dir == -1 && cl > ${P}obList[i].hi) {
         ${P}obList[i].phase     = ${P}PHASE_BB;
         ${P}obList[i].dir       = 1;
         ${P}obList[i].breakTime = t;
         ${P}obList[i].uniAge    = 0;
      }
   }
}

void ${P}MatchPass(int sh)
{
   datetime barT = iTime(InpSymbol, ${TF}, sh);
   long windowSecs = (long)PeriodSeconds(${TF}) * (long)${pairWindow};
   for(int i = 0; i < ${P}obCount; i++)
   {
      if(${P}obList[i].dead || ${P}obList[i].phase != ${P}PHASE_BB || ${P}obList[i].matched) continue;
      for(int f = 0; f < ${P}fvgCount; f++)
      {
         if(${P}fvgList[f].used) continue;
         if(${P}fvgList[f].dir != ${P}obList[i].dir) continue;
         long dt = (long)(${P}fvgList[f].confirmTime - ${P}obList[i].breakTime);
         if(dt < 0) dt = -dt;
         if(dt > windowSecs) continue;
         double ovTop = MathMin(${P}obList[i].hi, ${P}fvgList[f].top);
         double ovBot = MathMax(${P}obList[i].lo, ${P}fvgList[f].bot);
         if(ovBot >= ovTop) continue;
         ${P}obList[i].uTop    = ovTop;
         ${P}obList[i].uBot    = ovBot;
         ${P}obList[i].matched = true;
         ${P}fvgList[f].used   = true;
         ${P}AddUni(${P}obList[i].dir, ${P}obList[i].hi, ${P}obList[i].lo, ovTop, ovBot, barT);
         break;
      }
   }
}

void ${P}Lifecycle(int sh)
{
   double cl = iClose(InpSymbol, ${TF}, sh);
   datetime t = iTime(InpSymbol, ${TF}, sh);
   for(int i = 0; i < ${P}uniCount; i++)
   {
      if(${P}uniList[i].dead) continue;
      if(${P}uniList[i].matchTime > t) continue;
      if(${P}uniList[i].dir == 1 && cl < ${P}uniList[i].brkLo) ${P}uniList[i].dead = true;
      else if(${P}uniList[i].dir == -1 && cl > ${P}uniList[i].brkHi) ${P}uniList[i].dead = true;
   }
}

void ${P}AgeLevels()
{
   for(int i = 0; i < ${P}obCount; i++)
   {
      if(${P}obList[i].dead) continue;
      if(${P}obList[i].phase == ${P}PHASE_OB) {
         if(${obExpiry} <= 0) continue;
         ${P}obList[i].obAge++;
         if(${P}obList[i].obAge >= ${obExpiry}) ${P}obList[i].dead = true;
      }
      else if(!${P}obList[i].matched) {
         if(${uniExpiry} <= 0) continue;
         ${P}obList[i].uniAge++;
         if(${P}obList[i].uniAge >= ${uniExpiry}) ${P}obList[i].dead = true;
      }
   }
   for(int i = 0; i < ${P}uniCount; i++)
   {
      if(${P}uniList[i].dead) continue;
      if(${uniExpiry} <= 0) continue;
      ${P}uniList[i].barsAlive++;
      if(${P}uniList[i].barsAlive >= ${uniExpiry}) ${P}uniList[i].dead = true;
   }
}

void ${P}UpdateUniPocket(int sh)
{
   double lo = iLow (InpSymbol, ${TF}, sh);
   double hi = iHigh(InpSymbol, ${TF}, sh);
   double cl = iClose(InpSymbol, ${TF}, sh);
   datetime t = iTime(InpSymbol, ${TF}, sh);

   for(int i = 0; i < ${P}uniCount; i++)
   {
      if(${P}uniList[i].dead) continue;
      if(${P}uniList[i].matchTime >= t) continue;
      if(${P}uniList[i].state >= 2) continue;

      double ovTop = ${P}uniList[i].ovTop;
      double ovBot = ${P}uniList[i].ovBot;

      if(${P}uniList[i].dir == 1)
      {
         if(cl >= ovBot && cl <= ovTop) { ${P}uniList[i].dead = true; continue; }
         if(${P}uniList[i].state == 0 && lo <= ovTop)
         {
            ${P}uniList[i].state = 1;
            ${P}uniList[i].retestLow = lo;
            if(sh == 1) ${P}_bullJustRetested = true;
         }
         if(${P}uniList[i].state == 1)
         {
            if(lo < ${P}uniList[i].retestLow) ${P}uniList[i].retestLow = lo;
            if(cl > ovTop)
            {
               ${P}uniList[i].state = 2;
               ${P}uniList[i].dead = true;
               ${P}_bullSL = ${P}uniList[i].retestLow;
               if(sh == 1) ${P}_bullConfirmed = true;
            }
         }
      }
      else
      {
         if(cl >= ovBot && cl <= ovTop) { ${P}uniList[i].dead = true; continue; }
         if(${P}uniList[i].state == 0 && hi >= ovBot)
         {
            ${P}uniList[i].state = 1;
            ${P}uniList[i].retestHigh = hi;
            if(sh == 1) ${P}_bearJustRetested = true;
         }
         if(${P}uniList[i].state == 1)
         {
            if(hi > ${P}uniList[i].retestHigh) ${P}uniList[i].retestHigh = hi;
            if(cl < ovBot)
            {
               ${P}uniList[i].state = 2;
               ${P}uniList[i].dead = true;
               ${P}_bearSL = ${P}uniList[i].retestHigh;
               if(sh == 1) ${P}_bearConfirmed = true;
            }
         }
      }
   }
}

void ${P}Tick(int lookback)
{
   ${P}Reset();
   int total = iBars(InpSymbol, ${TF});
   int minBars = ${dispAtrPeriod} + ${obScanBack} + 4;
   int limit = (int)MathMin((long)lookback, (long)(total - minBars));
   if(limit < 1) return;
   for(int sh = limit; sh >= 1; sh--)
   {
      ${P}DetectOb(sh);
      ${P}DetectFvg(sh);
      ${P}CheckBreaks(sh);
      ${P}MatchPass(sh);
      ${P}Lifecycle(sh);
      ${P}UpdateUniPocket(sh);
      ${P}AgeLevels();
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
bool   ${P}BullJustRetested()  { return ${P}_bullJustRetested; }
bool   ${P}BearJustRetested()  { return ${P}_bearJustRetested; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int i = ${P}uniCount - 1; i >= 0; i--)
      if(!${P}uniList[i].dead && ${P}uniList[i].dir == 1 && ${P}uniList[i].state < 2) return true;
   return false;
}

bool ${P}HasActiveBear()
{
   for(int i = ${P}uniCount - 1; i >= 0; i--)
      if(!${P}uniList[i].dead && ${P}uniList[i].dir == -1 && ${P}uniList[i].state < 2) return true;
   return false;
}

double ${P}ActiveBullSL()
{
   for(int i = ${P}uniCount - 1; i >= 0; i--)
      if(!${P}uniList[i].dead && ${P}uniList[i].dir == 1) return ${P}uniList[i].brkLo;
   return 0.0;
}

double ${P}ActiveBearSL()
{
   for(int i = ${P}uniCount - 1; i >= 0; i--)
      if(!${P}uniList[i].dead && ${P}uniList[i].dir == -1) return ${P}uniList[i].brkHi;
   return 0.0;
}
`;
}
