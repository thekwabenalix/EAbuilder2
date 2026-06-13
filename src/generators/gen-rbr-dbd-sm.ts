/**
 * Inline RBR / DBD State Machine Generator
 *
 * RBR (Rally-Base-Rally) → demand zone. DBD (Drop-Base-Drop) → supply zone.
 * Zone = base high..low; invalidates on close through the zone.
 *
 * Standard API:
 *   RBRDBDSM_{id}_Reset()
 *   RBRDBDSM_{id}_Tick(lookback)
 *   RBRDBDSM_{id}_BullJustConfirmed() / BearJustConfirmed()
 *   RBRDBDSM_{id}_BullConfirmSL() / BearConfirmSL()
 *   RBRDBDSM_{id}_HasActiveBull() / HasActiveBear()
 *   RBRDBDSM_{id}_ActiveBullSL() / ActiveBearSL()
 */

export function genRbrDbdSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 400,
  expiryBars = 200,
  impulseRatio = 0.5,
  baseMaxRatio = 0.5,
  maxBaseCandles = 6,
  legBaseMult = 1.3,
): string {
  const P = `RBRDBDSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| RBR/DBD State Machine — ${tf} (${id})                              |
//| Rally-Base-Rally demand / Drop-Base-Drop supply zones             |
//+------------------------------------------------------------------+
#define ${P}DIR_DEMAND  1
#define ${P}DIR_SUPPLY -1

struct ${P}ZoneRec
{
   int      dir;
   double   hi;
   double   lo;
   datetime baseTime;
   datetime legOutTime;
   bool     dead;
   int      ageCounter;
};

#define ${P}MAX_ZONES 120
${P}ZoneRec ${P}zones[${P}MAX_ZONES];
int         ${P}zoneCount = 0;
bool        ${P}_bullConfirmed = false;
bool        ${P}_bearConfirmed = false;
double      ${P}_bullSL = 0.0;
double      ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}zoneCount = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

double ${P}BR(int sh)
{
   double o = iOpen (InpSymbol, ${TF}, sh);
   double c = iClose(InpSymbol, ${TF}, sh);
   double r = iHigh (InpSymbol, ${TF}, sh) - iLow(InpSymbol, ${TF}, sh);
   if(r <= 0.0) return 0.0;
   return MathAbs(c - o) / r;
}
double ${P}RNG(int sh) { return iHigh(InpSymbol, ${TF}, sh) - iLow(InpSymbol, ${TF}, sh); }
bool   ${P}BULL(int sh) { return iClose(InpSymbol, ${TF}, sh) > iOpen(InpSymbol, ${TF}, sh); }
bool   ${P}BEAR(int sh) { return iClose(InpSymbol, ${TF}, sh) < iOpen(InpSymbol, ${TF}, sh); }
bool   ${P}STRONG(int sh) { return ${P}BR(sh) >= ${impulseRatio}; }
bool   ${P}SMALL (int sh) { return ${P}BR(sh) <= ${baseMaxRatio}; }

void ${P}DetectRbrDbd(int sh)
{
   int avail = iBars(InpSymbol, ${TF});
   if(sh + 2 >= avail) return;

   if(!${P}STRONG(sh)) return;
   int dir;
   if(${P}BULL(sh))      dir = ${P}DIR_DEMAND;
   else if(${P}BEAR(sh)) dir = ${P}DIR_SUPPLY;
   else return;

   int baseLen = 0;
   while(baseLen < ${maxBaseCandles}
         && (sh + 1 + baseLen) < avail
         && ${P}SMALL(sh + 1 + baseLen))
      baseLen++;
   if(baseLen < 1) return;

   int legInSh = sh + 1 + baseLen;
   if(legInSh >= avail) return;

   if(!${P}STRONG(legInSh)) return;
   if(dir == ${P}DIR_DEMAND && !${P}BULL(legInSh)) return;
   if(dir == ${P}DIR_SUPPLY && !${P}BEAR(legInSh)) return;

   double baseHi = -1.0, baseLo = 1e18, sumRange = 0.0;
   for(int k = 0; k < baseLen; k++) {
      int b = sh + 1 + k;
      double h = iHigh(InpSymbol, ${TF}, b);
      double l = iLow (InpSymbol, ${TF}, b);
      if(h > baseHi) baseHi = h;
      if(l < baseLo) baseLo = l;
      sumRange += (h - l);
   }
   double avgBaseRange = sumRange / baseLen;
   if(avgBaseRange <= 0.0) return;

   if(${P}RNG(sh)      < ${legBaseMult} * avgBaseRange) return;
   if(${P}RNG(legInSh) < ${legBaseMult} * avgBaseRange) return;

   double legOutClose = iClose(InpSymbol, ${TF}, sh);
   if(dir == ${P}DIR_DEMAND && legOutClose <= baseHi) return;
   if(dir == ${P}DIR_SUPPLY && legOutClose >= baseLo) return;

   datetime baseTime   = iTime(InpSymbol, ${TF}, sh + baseLen);
   datetime legOutTime = iTime(InpSymbol, ${TF}, sh);

   for(int _k = 0; _k < ${P}zoneCount; _k++)
      if(!${P}zones[_k].dead && ${P}zones[_k].baseTime == baseTime) return;

   int idx = -1;
   for(int _k = 0; _k < ${P}zoneCount; _k++)
      if(${P}zones[_k].dead) { idx = _k; break; }
   if(idx < 0 && ${P}zoneCount < ${P}MAX_ZONES) idx = ${P}zoneCount++;
   if(idx < 0) return;

   ${P}zones[idx].dir        = dir;
   ${P}zones[idx].hi         = baseHi;
   ${P}zones[idx].lo         = baseLo;
   ${P}zones[idx].baseTime   = baseTime;
   ${P}zones[idx].legOutTime = legOutTime;
   ${P}zones[idx].dead       = false;
   ${P}zones[idx].ageCounter = 0;

   if(sh == 1) {
      if(dir == ${P}DIR_DEMAND) {
         ${P}_bullConfirmed = true;
         ${P}_bullSL = baseLo;
      } else {
         ${P}_bearConfirmed = true;
         ${P}_bearSL = baseHi;
      }
   }
}

void ${P}Maintain(int sh)
{
   datetime t  = iTime (InpSymbol, ${TF}, sh);
   double   cl = iClose(InpSymbol, ${TF}, sh);

   for(int i = 0; i < ${P}zoneCount; i++) {
      if(${P}zones[i].dead) continue;
      if(${P}zones[i].legOutTime >= t) continue;

      if(${P}zones[i].dir == ${P}DIR_DEMAND && cl < ${P}zones[i].lo) {
         ${P}zones[i].dead = true;
         continue;
      }
      if(${P}zones[i].dir == ${P}DIR_SUPPLY && cl > ${P}zones[i].hi) {
         ${P}zones[i].dead = true;
         continue;
      }

      ${P}zones[i].ageCounter++;
      if(${P}zones[i].ageCounter >= ${expiryBars}) ${P}zones[i].dead = true;
   }
}

void ${P}Tick(int scanBars)
{
   ${P}Reset();
   int scan = (int)MathMin((long)scanBars, (long)(iBars(InpSymbol, ${TF}) - 3));
   if(scan < 3) return;
   for(int sh = scan; sh >= 1; sh--) {
      ${P}DetectRbrDbd(sh);
      ${P}Maintain(sh);
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull()
{
   for(int i = ${P}zoneCount - 1; i >= 0; i--)
      if(!${P}zones[i].dead && ${P}zones[i].dir == ${P}DIR_DEMAND) return true;
   return false;
}

bool ${P}HasActiveBear()
{
   for(int i = ${P}zoneCount - 1; i >= 0; i--)
      if(!${P}zones[i].dead && ${P}zones[i].dir == ${P}DIR_SUPPLY) return true;
   return false;
}

double ${P}ActiveBullSL()
{
   for(int i = ${P}zoneCount - 1; i >= 0; i--)
      if(!${P}zones[i].dead && ${P}zones[i].dir == ${P}DIR_DEMAND) return ${P}zones[i].lo;
   return 0.0;
}

double ${P}ActiveBearSL()
{
   for(int i = ${P}zoneCount - 1; i >= 0; i--)
      if(!${P}zones[i].dead && ${P}zones[i].dir == ${P}DIR_SUPPLY) return ${P}zones[i].hi;
   return 0.0;
}
`;
}
