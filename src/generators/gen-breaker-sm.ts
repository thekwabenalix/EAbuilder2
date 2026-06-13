/**
 * Inline Breaker Block State Machine Generator (SMC BB — not Bollinger Bands)
 *
 * Two layers: OB detection (ATR displacement) → OB broken → Breaker Block born.
 * BB lifecycle: ACTIVE → RETESTED → CONFIRMED | MITIGATED | INVALIDATED | EXPIRED
 *
 * Standard API:
 *   BBSM_{id}_Reset()
 *   BBSM_{id}_Tick(lookback)
 *   BBSM_{id}_BullJustConfirmed() / BearJustConfirmed()
 *   BBSM_{id}_BullConfirmSL() / BearConfirmSL()
 *   BBSM_{id}_HasActiveBull() / HasActiveBear()
 *   BBSM_{id}_ActiveBullSL() / ActiveBearSL()
 */

export function genBreakerSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 500,
  atrPeriod = 14,
  dispMult = 1.5,
  obLookback = 5,
  expiryBars = 100,
): string {
  const P = `BBSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Breaker Block State Machine — ${tf} (${id})                      |
//| Failed OB flips polarity → BB zone → retest → confirm           |
//+------------------------------------------------------------------+
#define ${P}ACTIVE       0
#define ${P}RETESTED     1
#define ${P}CONFIRMED    2
#define ${P}MITIGATED    3
#define ${P}INVALIDATED  4
#define ${P}EXPIRED      5

struct ${P}ObRec
{
   int      id;
   int      dir;
   double   hi;
   double   lo;
   datetime time;
   bool     broken;
};

struct ${P}BbRec
{
   int      id;
   int      dir;
   double   hi;
   double   lo;
   int      state;
   int      barsAlive;
   datetime obTime;
   datetime breakoutTime;
   double   retestHigh;
   double   retestLow;
   bool     justConfirmed;
   double   confirmSL;
};

#define ${P}MAX_OBS 120
#define ${P}MAX_BBS 120
${P}ObRec ${P}obList[${P}MAX_OBS];
${P}BbRec ${P}bbList[${P}MAX_BBS];
int       ${P}obCount  = 0;
int       ${P}bbCount  = 0;
int       ${P}nextOId  = 1;
int       ${P}nextBId  = 1;
bool      ${P}_bullConfirmed = false;
bool      ${P}_bearConfirmed = false;
double    ${P}_bullSL = 0.0;
double    ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}obCount = 0;
   ${P}bbCount = 0;
   ${P}nextOId = 1;
   ${P}nextBId = 1;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

double ${P}CalcATR(int sh)
{
   double sum = 0.0;
   int total = iBars(InpSymbol, ${TF});
   for(int j = sh; j < sh + ${atrPeriod} && j + 1 < total; j++)
   {
      double h = iHigh(InpSymbol, ${TF}, j);
      double l = iLow (InpSymbol, ${TF}, j);
      double pc = iClose(InpSymbol, ${TF}, j + 1);
      sum += MathMax(h - l, MathMax(MathAbs(h - pc), MathAbs(l - pc)));
   }
   return (${atrPeriod} > 0) ? sum / ${atrPeriod} : 0.0;
}

void ${P}DetectOb(int sh)
{
   int total = iBars(InpSymbol, ${TF});
   if(sh + ${atrPeriod} + 1 >= total) return;

   double body = MathAbs(iClose(InpSymbol, ${TF}, sh) - iOpen(InpSymbol, ${TF}, sh));
   double atr  = ${P}CalcATR(sh);
   if(atr <= 0.0 || body < ${dispMult} * atr) return;

   bool isBullDisp = (iClose(InpSymbol, ${TF}, sh) > iOpen(InpSymbol, ${TF}, sh));

   for(int j = sh + 1; j <= sh + ${obLookback} && j + 1 < total; j++)
   {
      bool isBear = (iClose(InpSymbol, ${TF}, j) < iOpen(InpSymbol, ${TF}, j));
      bool isBull = (iClose(InpSymbol, ${TF}, j) > iOpen(InpSymbol, ${TF}, j));
      bool found  = (isBullDisp && isBear) || (!isBullDisp && isBull);
      if(!found) continue;

      datetime obT = iTime(InpSymbol, ${TF}, j);
      for(int k = 0; k < ${P}obCount; k++)
         if(!${P}obList[k].broken && ${P}obList[k].time == obT) return;

      int idx = -1;
      for(int k = 0; k < ${P}obCount; k++)
         if(${P}obList[k].broken) { idx = k; break; }
      if(idx < 0) {
         if(${P}obCount >= ${P}MAX_OBS) return;
         idx = ${P}obCount++;
      }
      ${P}obList[idx].id     = ${P}nextOId++;
      ${P}obList[idx].dir    = isBullDisp ? 1 : -1;
      ${P}obList[idx].hi     = iHigh(InpSymbol, ${TF}, j);
      ${P}obList[idx].lo     = iLow (InpSymbol, ${TF}, j);
      ${P}obList[idx].time   = obT;
      ${P}obList[idx].broken = false;
      return;
   }
}

void ${P}CheckObBreakout(int sh)
{
   double   closeV = iClose(InpSymbol, ${TF}, sh);
   datetime barT   = iTime (InpSymbol, ${TF}, sh);

   for(int k = 0; k < ${P}obCount; k++)
   {
      if(${P}obList[k].broken) continue;
      if(${P}obList[k].time >= barT) continue;

      if(${P}obList[k].dir == 1 && closeV < ${P}obList[k].lo)
      {
         int bIdx = -1;
         for(int m = 0; m < ${P}bbCount; m++)
            if(${P}bbList[m].state >= ${P}MITIGATED) { bIdx = m; break; }
         if(bIdx < 0) {
            if(${P}bbCount >= ${P}MAX_BBS) { ${P}obList[k].broken = true; continue; }
            bIdx = ${P}bbCount++;
         }
         ${P}bbList[bIdx].id           = ${P}nextBId++;
         ${P}bbList[bIdx].dir          = -1;
         ${P}bbList[bIdx].hi           = ${P}obList[k].hi;
         ${P}bbList[bIdx].lo           = ${P}obList[k].lo;
         ${P}bbList[bIdx].state        = ${P}ACTIVE;
         ${P}bbList[bIdx].barsAlive    = 0;
         ${P}bbList[bIdx].obTime       = ${P}obList[k].time;
         ${P}bbList[bIdx].breakoutTime = barT;
         ${P}bbList[bIdx].retestHigh   = 0.0;
         ${P}bbList[bIdx].retestLow    = 0.0;
         ${P}bbList[bIdx].justConfirmed = false;
         ${P}bbList[bIdx].confirmSL    = 0.0;
         ${P}obList[k].broken = true;
      }
      else if(${P}obList[k].dir == -1 && closeV > ${P}obList[k].hi)
      {
         int bIdx = -1;
         for(int m = 0; m < ${P}bbCount; m++)
            if(${P}bbList[m].state >= ${P}MITIGATED) { bIdx = m; break; }
         if(bIdx < 0) {
            if(${P}bbCount >= ${P}MAX_BBS) { ${P}obList[k].broken = true; continue; }
            bIdx = ${P}bbCount++;
         }
         ${P}bbList[bIdx].id           = ${P}nextBId++;
         ${P}bbList[bIdx].dir          = 1;
         ${P}bbList[bIdx].hi           = ${P}obList[k].hi;
         ${P}bbList[bIdx].lo           = ${P}obList[k].lo;
         ${P}bbList[bIdx].state        = ${P}ACTIVE;
         ${P}bbList[bIdx].barsAlive    = 0;
         ${P}bbList[bIdx].obTime       = ${P}obList[k].time;
         ${P}bbList[bIdx].breakoutTime = barT;
         ${P}bbList[bIdx].retestHigh   = 0.0;
         ${P}bbList[bIdx].retestLow    = 0.0;
         ${P}bbList[bIdx].justConfirmed = false;
         ${P}bbList[bIdx].confirmSL    = 0.0;
         ${P}obList[k].broken = true;
      }
   }
}

void ${P}UpdateBb(int sh)
{
   double   barHigh  = iHigh (InpSymbol, ${TF}, sh);
   double   barLow   = iLow  (InpSymbol, ${TF}, sh);
   double   barClose = iClose(InpSymbol, ${TF}, sh);
   datetime barT     = iTime (InpSymbol, ${TF}, sh);

   for(int i = 0; i < ${P}bbCount; i++)
   {
      int st = ${P}bbList[i].state;
      if(st >= ${P}MITIGATED) continue;
      if(${P}bbList[i].breakoutTime >= barT) continue;

      bool isBull = (${P}bbList[i].dir == 1);
      double bbHi = ${P}bbList[i].hi;
      double bbLo = ${P}bbList[i].lo;

      ${P}bbList[i].barsAlive++;
      ${P}bbList[i].justConfirmed = false;

      if(${P}bbList[i].barsAlive >= ${expiryBars}) {
         ${P}bbList[i].state = ${P}EXPIRED;
         continue;
      }

      if(isBull)
      {
         if(barClose < bbLo) { ${P}bbList[i].state = ${P}INVALIDATED; continue; }
         if(barClose >= bbLo && barClose <= bbHi) { ${P}bbList[i].state = ${P}MITIGATED; continue; }
         if(st == ${P}RETESTED && barClose > bbHi)
         {
            ${P}bbList[i].state = ${P}CONFIRMED;
            ${P}bbList[i].justConfirmed = true;
            ${P}bbList[i].confirmSL = ${P}bbList[i].retestLow;
            if(sh == 1) {
               ${P}_bullConfirmed = true;
               ${P}_bullSL = ${P}bbList[i].retestLow;
            }
            continue;
         }
         if(st != ${P}RETESTED && barLow <= bbHi)
         {
            ${P}bbList[i].state = ${P}RETESTED;
            if(barLow  < ${P}bbList[i].retestLow  || ${P}bbList[i].retestLow  == 0.0) ${P}bbList[i].retestLow  = barLow;
            if(barHigh > ${P}bbList[i].retestHigh || ${P}bbList[i].retestHigh == 0.0) ${P}bbList[i].retestHigh = barHigh;
         }
         else if(st == ${P}RETESTED)
         {
            if(barLow  < ${P}bbList[i].retestLow)  ${P}bbList[i].retestLow  = barLow;
            if(barHigh > ${P}bbList[i].retestHigh) ${P}bbList[i].retestHigh = barHigh;
         }
      }
      else
      {
         if(barClose > bbHi) { ${P}bbList[i].state = ${P}INVALIDATED; continue; }
         if(barClose >= bbLo && barClose <= bbHi) { ${P}bbList[i].state = ${P}MITIGATED; continue; }
         if(st == ${P}RETESTED && barClose < bbLo)
         {
            ${P}bbList[i].state = ${P}CONFIRMED;
            ${P}bbList[i].justConfirmed = true;
            ${P}bbList[i].confirmSL = ${P}bbList[i].retestHigh;
            if(sh == 1) {
               ${P}_bearConfirmed = true;
               ${P}_bearSL = ${P}bbList[i].retestHigh;
            }
            continue;
         }
         if(st != ${P}RETESTED && barHigh >= bbLo)
         {
            ${P}bbList[i].state = ${P}RETESTED;
            if(barLow  < ${P}bbList[i].retestLow  || ${P}bbList[i].retestLow  == 0.0) ${P}bbList[i].retestLow  = barLow;
            if(barHigh > ${P}bbList[i].retestHigh || ${P}bbList[i].retestHigh == 0.0) ${P}bbList[i].retestHigh = barHigh;
         }
         else if(st == ${P}RETESTED)
         {
            if(barLow  < ${P}bbList[i].retestLow)  ${P}bbList[i].retestLow  = barLow;
            if(barHigh > ${P}bbList[i].retestHigh) ${P}bbList[i].retestHigh = barHigh;
         }
      }
   }
}

void ${P}Tick(int lookback)
{
   ${P}Reset();
   int total = iBars(InpSymbol, ${TF});
   int minBars = ${atrPeriod} + ${obLookback} + 2;
   int limit = (int)MathMin((long)lookback, (long)(total - minBars));
   if(limit < 1) return;

   for(int sh = limit; sh >= 1; sh--)
   {
      ${P}DetectOb(sh);
      ${P}CheckObBreakout(sh);
      ${P}UpdateBb(sh);
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int i = ${P}bbCount - 1; i >= 0; i--)
      if(${P}bbList[i].dir == 1 && ${P}bbList[i].state <= ${P}CONFIRMED) return true;
   return false;
}

bool ${P}HasActiveBear()
{
   for(int i = ${P}bbCount - 1; i >= 0; i--)
      if(${P}bbList[i].dir == -1 && ${P}bbList[i].state <= ${P}CONFIRMED) return true;
   return false;
}

double ${P}ActiveBullSL()
{
   for(int i = ${P}bbCount - 1; i >= 0; i--)
      if(${P}bbList[i].dir == 1 && ${P}bbList[i].state <= ${P}CONFIRMED)
         return (${P}bbList[i].retestLow > 0.0) ? ${P}bbList[i].retestLow : ${P}bbList[i].lo;
   return 0.0;
}

double ${P}ActiveBearSL()
{
   for(int i = ${P}bbCount - 1; i >= 0; i--)
      if(${P}bbList[i].dir == -1 && ${P}bbList[i].state <= ${P}CONFIRMED)
         return (${P}bbList[i].retestHigh > 0.0) ? ${P}bbList[i].retestHigh : ${P}bbList[i].hi;
   return 0.0;
}
`;
}
