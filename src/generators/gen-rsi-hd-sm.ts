/**
 * Inline RSI Hidden Divergence State Machine Generator
 *
 * Mirrors the standalone RSI_Hidden_Divergence_State_Module:
 *   ACTIVE when hidden divergence is detected.
 *   CONFIRMED only after price closes beyond the intervening swing level.
 *   INVALIDATED when price closes beyond the second swing.
 *   EXPIRED after expiryBars.
 *
 * This file is the self-contained EA version of the tested module logic. Keep
 * it aligned with src/lib/indicator-modules/rsi-hidden-divergence-state-module.ts.
 */

export function genRsiHdSM(
  id: string,
  TF: string,
  tf: string,
  rsiPeriod = 14,
  pivotLeft = 3,
  pivotRight = 3,
  minBars = 5,
  maxBars = 50,
  expiryBars = 60,
): string {
  const P = `RSIHDSM_${id}_`;
  const maxRec = 200;

  return `
//+------------------------------------------------------------------+
//| RSI Hidden Divergence State Machine — ${tf} (${id})              |
//| Same lifecycle as RSI_Hidden_Divergence_State_Module.           |
//| ACTIVE on HD detection; CONFIRMED on close beyond mid swing.    |
//+------------------------------------------------------------------+
#define ${P}DIR_BULL    1
#define ${P}DIR_BEAR   -1
#define ${P}ST_ACTIVE   0
#define ${P}ST_CONFIRM  1
#define ${P}ST_INVALID  2
#define ${P}ST_EXPIRED  3

int      ${P}rsiHandle = INVALID_HANDLE;
datetime ${P}lastBarTime = 0;
bool     ${P}_bullConfirmed = false;
bool     ${P}_bearConfirmed = false;
bool     ${P}_bullDiverged = false;
bool     ${P}_bearDiverged = false;
double   ${P}_bullSL = 0.0;
double   ${P}_bearSL = 0.0;

bool     ${P}gHasLow  = false; double ${P}gLowPrice  = 0.0, ${P}gLowRSI  = 0.0; datetime ${P}gLowTime  = 0;
bool     ${P}gHasHigh = false; double ${P}gHighPrice = 0.0, ${P}gHighRSI = 0.0; datetime ${P}gHighTime = 0;

struct ${P}HDRec
{
   int      id;
   int      dir;
   int      state;
   double   swing1;
   double   swing2;
   double   midLevel;
   datetime t1;
   datetime t2;
   datetime confirmTime;
   bool     dead;
   int      ageCounter;
};

${P}HDRec ${P}rec[${maxRec}];
int   ${P}recTotal = 0;
int   ${P}nextId   = 0;

void ${P}Reset()
{
   if(${P}rsiHandle == INVALID_HANDLE)
      ${P}rsiHandle = iRSI(InpSymbol, ${TF}, ${rsiPeriod}, PRICE_CLOSE);
   ${P}lastBarTime = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullDiverged = false;
   ${P}_bearDiverged = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
   ${P}gHasLow = false;
   ${P}gHasHigh = false;
   ${P}recTotal = 0;
   ${P}nextId = 0;
}

double ${P}RSIv(int sh)
{
   if(${P}rsiHandle == INVALID_HANDLE)
      ${P}rsiHandle = iRSI(InpSymbol, ${TF}, ${rsiPeriod}, PRICE_CLOSE);
   if(${P}rsiHandle == INVALID_HANDLE) return EMPTY_VALUE;
   double b[];
   if(CopyBuffer(${P}rsiHandle, 0, sh, 1, b) != 1) return EMPTY_VALUE;
   return b[0];
}

bool ${P}IsPivotLow(int p)
{
   int bars = iBars(InpSymbol, ${TF});
   if(p - ${pivotRight} < 0 || p + ${pivotLeft} >= bars) return false;
   double lo = iLow(InpSymbol, ${TF}, p);
   for(int k = 1; k <= ${pivotLeft};  k++) if(iLow(InpSymbol, ${TF}, p + k) <= lo) return false;
   for(int k = 1; k <= ${pivotRight}; k++) if(iLow(InpSymbol, ${TF}, p - k) <  lo) return false;
   return true;
}

bool ${P}IsPivotHigh(int p)
{
   int bars = iBars(InpSymbol, ${TF});
   if(p - ${pivotRight} < 0 || p + ${pivotLeft} >= bars) return false;
   double hi = iHigh(InpSymbol, ${TF}, p);
   for(int k = 1; k <= ${pivotLeft};  k++) if(iHigh(InpSymbol, ${TF}, p + k) >= hi) return false;
   for(int k = 1; k <= ${pivotRight}; k++) if(iHigh(InpSymbol, ${TF}, p - k) >  hi) return false;
   return true;
}

double ${P}HighestBetween(int sNew, int sOld)
{
   double mx = -DBL_MAX;
   for(int k = sNew + 1; k <= sOld - 1; k++) mx = MathMax(mx, iHigh(InpSymbol, ${TF}, k));
   return mx;
}

double ${P}LowestBetween(int sNew, int sOld)
{
   double mn = DBL_MAX;
   for(int k = sNew + 1; k <= sOld - 1; k++) mn = MathMin(mn, iLow(InpSymbol, ${TF}, k));
   return mn;
}

void ${P}AddRec(int dir, double s1, double s2, double mid, datetime t1, datetime t2, datetime confT)
{
   int idx = -1;
   for(int i = 0; i < ${P}recTotal; i++) if(${P}rec[i].dead) { idx = i; break; }
   if(idx < 0 && ${P}recTotal < ${maxRec}) idx = ${P}recTotal++;
   if(idx < 0) return;
   ${P}rec[idx].id          = ${P}nextId++;
   ${P}rec[idx].dir         = dir;
   ${P}rec[idx].state       = ${P}ST_ACTIVE;
   ${P}rec[idx].swing1      = s1;
   ${P}rec[idx].swing2      = s2;
   ${P}rec[idx].midLevel    = mid;
   ${P}rec[idx].t1          = t1;
   ${P}rec[idx].t2          = t2;
   ${P}rec[idx].confirmTime = confT;
   ${P}rec[idx].dead        = false;
   ${P}rec[idx].ageCounter  = 0;
   if(dir > 0) ${P}_bullDiverged = true; else ${P}_bearDiverged = true;
   PrintFormat("[RSIHDSM_${tf}] %s ACTIVE | s1=%.5f s2=%.5f mid=%.5f",
               dir > 0 ? "BULL HD" : "BEAR HD", s1, s2, mid);
}

void ${P}ProcessPivots(int sh)
{
   int p = sh + ${pivotRight};

   if(${P}IsPivotLow(p))
   {
      double price = iLow(InpSymbol, ${TF}, p);
      double rsi   = ${P}RSIv(p);
      datetime tp  = iTime(InpSymbol, ${TF}, p);
      if(${P}gHasLow && rsi != EMPTY_VALUE)
      {
         int s1  = iBarShift(InpSymbol, ${TF}, ${P}gLowTime);
         int gap = s1 - p;
         if(gap >= ${minBars} && gap <= ${maxBars} && price > ${P}gLowPrice && rsi < ${P}gLowRSI)
         {
            double mid = ${P}HighestBetween(p, s1);
            if(mid > -DBL_MAX)
               ${P}AddRec(${P}DIR_BULL, ${P}gLowPrice, price, mid, ${P}gLowTime, tp, iTime(InpSymbol, ${TF}, sh));
         }
      }
      if(rsi != EMPTY_VALUE) { ${P}gLowPrice = price; ${P}gLowRSI = rsi; ${P}gLowTime = tp; ${P}gHasLow = true; }
   }

   if(${P}IsPivotHigh(p))
   {
      double price = iHigh(InpSymbol, ${TF}, p);
      double rsi   = ${P}RSIv(p);
      datetime tp  = iTime(InpSymbol, ${TF}, p);
      if(${P}gHasHigh && rsi != EMPTY_VALUE)
      {
         int s1  = iBarShift(InpSymbol, ${TF}, ${P}gHighTime);
         int gap = s1 - p;
         if(gap >= ${minBars} && gap <= ${maxBars} && price < ${P}gHighPrice && rsi > ${P}gHighRSI)
         {
            double mid = ${P}LowestBetween(p, s1);
            if(mid < DBL_MAX)
               ${P}AddRec(${P}DIR_BEAR, ${P}gHighPrice, price, mid, ${P}gHighTime, tp, iTime(InpSymbol, ${TF}, sh));
         }
      }
      if(rsi != EMPTY_VALUE) { ${P}gHighPrice = price; ${P}gHighRSI = rsi; ${P}gHighTime = tp; ${P}gHasHigh = true; }
   }
}

void ${P}Lifecycle(int sh)
{
   double cl = iClose(InpSymbol, ${TF}, sh);
   datetime t = iTime(InpSymbol, ${TF}, sh);

   for(int i = 0; i < ${P}recTotal; i++)
   {
      if(${P}rec[i].dead || ${P}rec[i].state != ${P}ST_ACTIVE) continue;
      if(${P}rec[i].confirmTime >= t) continue;

      if(${P}rec[i].dir == ${P}DIR_BULL)
      {
         if(cl < ${P}rec[i].swing2)
         {
            ${P}rec[i].state = ${P}ST_INVALID;
            ${P}rec[i].dead = true;
            PrintFormat("[RSIHDSM_${tf}] BULL INVALID | %s", TimeToString(t,TIME_DATE|TIME_MINUTES));
            continue;
         }
         if(cl > ${P}rec[i].midLevel)
         {
            ${P}rec[i].state = ${P}ST_CONFIRM;
            ${P}_bullConfirmed = true;
            ${P}_bullSL = ${P}rec[i].swing2;
            ${P}rec[i].dead = true;
            PrintFormat("[RSIHDSM_${tf}] BULL CONFIRMED | sl=%.5f | %s",
                        ${P}rec[i].swing2, TimeToString(t,TIME_DATE|TIME_MINUTES));
            continue;
         }
      }
      else
      {
         if(cl > ${P}rec[i].swing2)
         {
            ${P}rec[i].state = ${P}ST_INVALID;
            ${P}rec[i].dead = true;
            PrintFormat("[RSIHDSM_${tf}] BEAR INVALID | %s", TimeToString(t,TIME_DATE|TIME_MINUTES));
            continue;
         }
         if(cl < ${P}rec[i].midLevel)
         {
            ${P}rec[i].state = ${P}ST_CONFIRM;
            ${P}_bearConfirmed = true;
            ${P}_bearSL = ${P}rec[i].swing2;
            ${P}rec[i].dead = true;
            PrintFormat("[RSIHDSM_${tf}] BEAR CONFIRMED | sl=%.5f | %s",
                        ${P}rec[i].swing2, TimeToString(t,TIME_DATE|TIME_MINUTES));
            continue;
         }
      }

      ${P}rec[i].ageCounter++;
      if(${expiryBars} > 0 && ${P}rec[i].ageCounter >= ${expiryBars})
      {
         ${P}rec[i].state = ${P}ST_EXPIRED;
         ${P}rec[i].dead = true;
      }
   }
}

void ${P}Tick(int lookback)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullDiverged = false;
   ${P}_bearDiverged = false;

   int total = iBars(InpSymbol, ${TF});
   if(total < ${pivotLeft + pivotRight + 5}) return;
   if(${P}rsiHandle == INVALID_HANDLE)
      ${P}rsiHandle = iRSI(InpSymbol, ${TF}, ${rsiPeriod}, PRICE_CLOSE);
   if(${P}rsiHandle == INVALID_HANDLE) return;

   if(${P}lastBarTime == 0)
   {
      int limit = (int)MathMin((long)(total - ${pivotLeft} - 2), (long)lookback);
      for(int sh = limit; sh >= 1; sh--) { ${P}ProcessPivots(sh); ${P}Lifecycle(sh); }
      ${P}lastBarTime = iTime(InpSymbol, ${TF}, 0);
      return;
   }

   datetime curBar = iTime(InpSymbol, ${TF}, 0);
   if(curBar != ${P}lastBarTime)
   {
      ${P}lastBarTime = curBar;
      ${P}ProcessPivots(1);
      ${P}Lifecycle(1);
   }
}

bool   ${P}BullJustDiverged()  { return ${P}_bullDiverged; }
bool   ${P}BearJustDiverged()  { return ${P}_bearDiverged; }
bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int i = 0; i < ${P}recTotal; i++)
      if(!${P}rec[i].dead && ${P}rec[i].state == ${P}ST_ACTIVE && ${P}rec[i].dir == ${P}DIR_BULL) return true;
   return false;
}
bool ${P}HasActiveBear()
{
   for(int i = 0; i < ${P}recTotal; i++)
      if(!${P}rec[i].dead && ${P}rec[i].state == ${P}ST_ACTIVE && ${P}rec[i].dir == ${P}DIR_BEAR) return true;
   return false;
}
double ${P}ActiveBullSL()
{
   for(int i = 0; i < ${P}recTotal; i++)
      if(!${P}rec[i].dead && ${P}rec[i].state == ${P}ST_ACTIVE && ${P}rec[i].dir == ${P}DIR_BULL) return ${P}rec[i].swing2;
   return 0.0;
}
double ${P}ActiveBearSL()
{
   for(int i = 0; i < ${P}recTotal; i++)
      if(!${P}rec[i].dead && ${P}rec[i].state == ${P}ST_ACTIVE && ${P}rec[i].dir == ${P}DIR_BEAR) return ${P}rec[i].swing2;
   return 0.0;
}
`;
}
