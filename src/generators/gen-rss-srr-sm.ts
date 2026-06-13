/**
 * Inline RSS / SRR State Machine Generator
 *
 * RSS: Classic Resistance R drives ≥ minBreaks Support close-breaks below → sell signal.
 * SRR: Classic Support S drives ≥ minBreaks Resistance close-breaks above → buy signal.
 *
 * Standard API:
 *   RSSSRRSM_{id}_Reset()
 *   RSSSRRSM_{id}_Tick(lookback)
 *   RSSSRRSM_{id}_BullJustConfirmed()  — SRR fired this bar (buy)
 *   RSSSRRSM_{id}_BearJustConfirmed()  — RSS fired this bar (sell)
 *   RSSSRRSM_{id}_BullConfirmSL()      — driving S wick low
 *   RSSSRRSM_{id}_BearConfirmSL()      — driving R wick high
 *   RSSSRRSM_{id}_HasActiveBull()      — live SRR (swept S, not invalidated)
 *   RSSSRRSM_{id}_HasActiveBear()      — live RSS (swept R, not invalidated)
 *   RSSSRRSM_{id}_ActiveBullSL() / ActiveBearSL()
 */

export function genRssSrrSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 500,
  minBreaks = 2,
  expiryBars = 150,
  ignoreDoji = true,
): string {
  const P = `RSSSRRSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| RSS/SRR State Machine — ${tf} (${id})                            |
//| Repeated resistance/support sweep counter signals               |
//+------------------------------------------------------------------+
#define ${P}TYPE_SUPPORT    1
#define ${P}TYPE_RESISTANCE 2
#define ${P}MAX_SWEPT       10

struct ${P}LevelRec
{
   int      type;
   double   level;
   double   wickExtreme;
   datetime levelTime;
   datetime confirmTime;
   bool     broken;
   bool     justBroken;
   bool     swept;
   bool     invalidated;
   int      ageCounter;
   int      sweepCount;
   double   sweptPrices[${P}MAX_SWEPT];
   datetime sweptTimes[${P}MAX_SWEPT];
   int      sweptN;
};

#define ${P}MAX_LEVELS 600
${P}LevelRec ${P}levels[${P}MAX_LEVELS];
int          ${P}levelCount = 0;
bool         ${P}_bullConfirmed = false;
bool         ${P}_bearConfirmed = false;
double       ${P}_bullSL = 0.0;
double       ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}levelCount = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

int ${P}CandleDir(int sh)
{
   double c = iClose(InpSymbol, ${TF}, sh);
   double o = iOpen (InpSymbol, ${TF}, sh);
   if(${ignoreDoji}) {
      double range = iHigh(InpSymbol, ${TF}, sh) - iLow(InpSymbol, ${TF}, sh);
      if(range > 0 && MathAbs(c - o) / range < 0.1) return 0;
   }
   if(c > o) return  1;
   if(c < o) return -1;
   return 0;
}

void ${P}AddLevel(int type, double level, double wickExt, datetime tA, datetime tB)
{
   for(int i = 0; i < ${P}levelCount; i++)
      if(${P}levels[i].levelTime == tA && ${P}levels[i].type == type) return;
   int idx = -1;
   for(int i = 0; i < ${P}levelCount; i++)
      if(${P}levels[i].broken && !${P}levels[i].swept) { idx = i; break; }
   if(idx < 0 && ${P}levelCount < ${P}MAX_LEVELS) idx = ${P}levelCount++;
   if(idx < 0) return;
   ${P}levels[idx].type         = type;
   ${P}levels[idx].level        = level;
   ${P}levels[idx].wickExtreme  = wickExt;
   ${P}levels[idx].levelTime    = tA;
   ${P}levels[idx].confirmTime  = tB;
   ${P}levels[idx].broken       = false;
   ${P}levels[idx].justBroken  = false;
   ${P}levels[idx].swept        = false;
   ${P}levels[idx].invalidated  = false;
   ${P}levels[idx].ageCounter   = 0;
   ${P}levels[idx].sweepCount   = 0;
   ${P}levels[idx].sweptN       = 0;
}

void ${P}DetectLevels(int shA, int shB)
{
   int avail = iBars(InpSymbol, ${TF});
   if(shA >= avail || shB < 0) return;
   int dirA = ${P}CandleDir(shA);
   int dirB = ${P}CandleDir(shB);
   if(dirA == 0 || dirB == 0) return;
   double   lvl  = iClose(InpSymbol, ${TF}, shA);
   double   wick = (dirA > 0) ? iHigh(InpSymbol, ${TF}, shA) : iLow(InpSymbol, ${TF}, shA);
   datetime tA   = iTime (InpSymbol, ${TF}, shA);
   datetime tB   = iTime (InpSymbol, ${TF}, shB);
   if(dirA > 0 && dirB < 0) ${P}AddLevel(${P}TYPE_RESISTANCE, lvl, wick, tA, tB);
   if(dirA < 0 && dirB > 0) ${P}AddLevel(${P}TYPE_SUPPORT,    lvl, wick, tA, tB);
}

void ${P}CheckInvalidations(int sh)
{
   double   c = iClose(InpSymbol, ${TF}, sh);
   datetime t = iTime (InpSymbol, ${TF}, sh);
   for(int j = 0; j < ${P}levelCount; j++)
   {
      if(${P}levels[j].invalidated) continue;
      if(${P}levels[j].confirmTime >= t) continue;
      bool hit = false;
      if(${P}levels[j].type == ${P}TYPE_RESISTANCE && c > ${P}levels[j].wickExtreme) hit = true;
      if(${P}levels[j].type == ${P}TYPE_SUPPORT    && c < ${P}levels[j].wickExtreme) hit = true;
      if(hit) ${P}levels[j].invalidated = true;
   }
}

void ${P}CheckSweeps(int sh)
{
   double   barClose = iClose(InpSymbol, ${TF}, sh);
   datetime t        = iTime (InpSymbol, ${TF}, sh);

   for(int i = 0; i < ${P}levelCount; i++)
   {
      ${P}levels[i].justBroken = false;
      if(${P}levels[i].broken || ${P}levels[i].invalidated) continue;
      if(${P}levels[i].confirmTime >= t) continue;
      if(${P}levels[i].type == ${P}TYPE_SUPPORT && barClose < ${P}levels[i].level)
         { ${P}levels[i].broken = true; ${P}levels[i].justBroken = true; }
      else if(${P}levels[i].type == ${P}TYPE_RESISTANCE && barClose > ${P}levels[i].level)
         { ${P}levels[i].broken = true; ${P}levels[i].justBroken = true; }
   }

   for(int i = 0; i < ${P}levelCount; i++)
   {
      if(!${P}levels[i].justBroken) continue;
      if(${P}levels[i].type == ${P}TYPE_SUPPORT)
      {
         double bSup = ${P}levels[i].level;
         datetime bTime = ${P}levels[i].levelTime;
         for(int j = 0; j < ${P}levelCount; j++)
         {
            if(${P}levels[j].type != ${P}TYPE_RESISTANCE) continue;
            if(${P}levels[j].broken || ${P}levels[j].swept || ${P}levels[j].invalidated) continue;
            if(${P}levels[j].confirmTime >= t || ${P}levels[j].level <= bSup) continue;
            ${P}levels[j].sweepCount++;
            if(${P}levels[j].sweptN < ${P}MAX_SWEPT) {
               ${P}levels[j].sweptPrices[${P}levels[j].sweptN] = bSup;
               ${P}levels[j].sweptTimes[${P}levels[j].sweptN]  = bTime;
               ${P}levels[j].sweptN++;
            }
            if(${P}levels[j].sweepCount >= ${minBreaks})
            {
               ${P}levels[j].swept = true;
               if(sh == 1) {
                  ${P}_bearConfirmed = true;
                  ${P}_bearSL = ${P}levels[j].wickExtreme;
               }
            }
         }
      }
      else
      {
         double bRes = ${P}levels[i].level;
         datetime bTime = ${P}levels[i].levelTime;
         for(int j = 0; j < ${P}levelCount; j++)
         {
            if(${P}levels[j].type != ${P}TYPE_SUPPORT) continue;
            if(${P}levels[j].broken || ${P}levels[j].swept || ${P}levels[j].invalidated) continue;
            if(${P}levels[j].confirmTime >= t || ${P}levels[j].level >= bRes) continue;
            ${P}levels[j].sweepCount++;
            if(${P}levels[j].sweptN < ${P}MAX_SWEPT) {
               ${P}levels[j].sweptPrices[${P}levels[j].sweptN] = bRes;
               ${P}levels[j].sweptTimes[${P}levels[j].sweptN]  = bTime;
               ${P}levels[j].sweptN++;
            }
            if(${P}levels[j].sweepCount >= ${minBreaks})
            {
               ${P}levels[j].swept = true;
               if(sh == 1) {
                  ${P}_bullConfirmed = true;
                  ${P}_bullSL = ${P}levels[j].wickExtreme;
               }
            }
         }
      }
   }
}

void ${P}AgeLevels()
{
   if(${expiryBars} <= 0) return;
   for(int i = 0; i < ${P}levelCount; i++)
   {
      if(${P}levels[i].broken || ${P}levels[i].swept || ${P}levels[i].invalidated) continue;
      ${P}levels[i].ageCounter++;
      if(${P}levels[i].ageCounter >= ${expiryBars}) ${P}levels[i].broken = true;
   }
}

void ${P}Tick(int scanBars)
{
   ${P}Reset();
   int total = iBars(InpSymbol, ${TF});
   int limit = (int)MathMin((long)scanBars, (long)(total - 2));
   if(limit < 1) return;
   for(int sh = limit; sh >= 1; sh--)
   {
      ${P}DetectLevels(sh + 1, sh);
      ${P}CheckInvalidations(sh);
      ${P}CheckSweeps(sh);
      ${P}AgeLevels();
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int i = ${P}levelCount - 1; i >= 0; i--)
      if(${P}levels[i].type == ${P}TYPE_SUPPORT && ${P}levels[i].swept && !${P}levels[i].invalidated)
         return true;
   return false;
}

bool ${P}HasActiveBear()
{
   for(int i = ${P}levelCount - 1; i >= 0; i--)
      if(${P}levels[i].type == ${P}TYPE_RESISTANCE && ${P}levels[i].swept && !${P}levels[i].invalidated)
         return true;
   return false;
}

double ${P}ActiveBullSL()
{
   for(int i = ${P}levelCount - 1; i >= 0; i--)
      if(${P}levels[i].type == ${P}TYPE_SUPPORT && ${P}levels[i].swept && !${P}levels[i].invalidated)
         return ${P}levels[i].wickExtreme;
   return 0.0;
}

double ${P}ActiveBearSL()
{
   for(int i = ${P}levelCount - 1; i >= 0; i--)
      if(${P}levels[i].type == ${P}TYPE_RESISTANCE && ${P}levels[i].swept && !${P}levels[i].invalidated)
         return ${P}levels[i].wickExtreme;
   return 0.0;
}
`;
}
