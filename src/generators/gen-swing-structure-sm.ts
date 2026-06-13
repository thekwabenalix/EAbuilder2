/**
 * Inline Swing Structure State Machine Generator
 *
 * Confirmed pivot highs/lows → HH/HL or LH/LL bias.
 *
 * Standard API (direction):
 *   SWINGSM_{id}_IsBull() / IsBear()
 *
 * Standard API (setup / events):
 *   SWINGSM_{id}_BullJustConfirmed() / BearJustConfirmed()  — pivot confirmed this bar
 *   SWINGSM_{id}_BullConfirmSL() / BearConfirmSL()
 *   SWINGSM_{id}_HasActiveBull() / HasActiveBear()
 *   SWINGSM_{id}_ActiveBullSL() / ActiveBearSL()
 */

export function genSwingStructureSM(
  id: string,
  TF: string,
  tf: string,
  lookback = 500,
  swingLeft = 3,
  swingRight = 3,
): string {
  const P = `SWINGSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Swing Structure SM — ${tf} (${id})                                 |
//| Confirmed pivots → HH/HL bull or LH/LL bear bias                  |
//+------------------------------------------------------------------+
#define ${P}SWING_HIGH  1
#define ${P}SWING_LOW  -1

struct ${P}SwingRec
{
   int      type;
   double   price;
   datetime time;
};

#define ${P}MAX_SWINGS 200
${P}SwingRec ${P}swings[${P}MAX_SWINGS];
int         ${P}swingCount = 0;
double      ${P}lastHigh1 = 0.0;
double      ${P}lastHigh2 = 0.0;
double      ${P}lastLow1  = 0.0;
double      ${P}lastLow2  = 0.0;
int         ${P}highCount = 0;
int         ${P}lowCount  = 0;
int         ${P}bias      = 0;
bool        ${P}_bullConfirmed = false;
bool        ${P}_bearConfirmed = false;
double      ${P}_bullSL = 0.0;
double      ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}swingCount = 0;
   ${P}lastHigh1 = ${P}lastHigh2 = 0.0;
   ${P}lastLow1  = ${P}lastLow2  = 0.0;
   ${P}highCount = ${P}lowCount = 0;
   ${P}bias = 0;
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

void ${P}PushSwing(int type, double price, datetime t, int sh)
{
   if(${P}swingCount >= ${P}MAX_SWINGS) return;
   ${P}swings[${P}swingCount].type  = type;
   ${P}swings[${P}swingCount].price = price;
   ${P}swings[${P}swingCount].time  = t;
   ${P}swingCount++;

   if(type == ${P}SWING_HIGH) {
      ${P}lastHigh2 = ${P}lastHigh1;
      ${P}lastHigh1 = price;
      ${P}highCount++;
      if(sh == ${swingRight} + 1) {
         ${P}_bullConfirmed = true;
         ${P}_bullSL = ${P}lastLow1;
      }
   } else {
      ${P}lastLow2 = ${P}lastLow1;
      ${P}lastLow1 = price;
      ${P}lowCount++;
      if(sh == ${swingRight} + 1) {
         ${P}_bearConfirmed = true;
         ${P}_bearSL = ${P}lastHigh1;
      }
   }
}

void ${P}ScanBar(int sh)
{
   int avail = iBars(InpSymbol, ${TF});
   if(sh < ${swingRight} + 1 || sh + ${swingLeft} >= avail) return;

   double   hi = iHigh(InpSymbol, ${TF}, sh);
   double   lo = iLow (InpSymbol, ${TF}, sh);
   datetime t  = iTime(InpSymbol, ${TF}, sh);

   bool isHigh = true, isLow = true;
   int  maxK   = (int)MathMax(${swingLeft}, ${swingRight});
   for(int k = 1; k <= maxK && (isHigh || isLow); k++)
   {
      if(k <= ${swingLeft}) {
         if(iHigh(InpSymbol, ${TF}, sh + k) >= hi) isHigh = false;
         if(iLow (InpSymbol, ${TF}, sh + k) <= lo) isLow  = false;
      }
      if(k <= ${swingRight}) {
         if(iHigh(InpSymbol, ${TF}, sh - k) >= hi) isHigh = false;
         if(iLow (InpSymbol, ${TF}, sh - k) <= lo) isLow  = false;
      }
   }

   if(isHigh) {
      for(int i = 0; i < ${P}swingCount; i++)
         if(${P}swings[i].type == ${P}SWING_HIGH && ${P}swings[i].time == t) return;
      ${P}PushSwing(${P}SWING_HIGH, hi, t, sh);
   }

   if(isLow) {
      for(int i = 0; i < ${P}swingCount; i++)
         if(${P}swings[i].type == ${P}SWING_LOW && ${P}swings[i].time == t) return;
      ${P}PushSwing(${P}SWING_LOW, lo, t, sh);
   }
}

void ${P}UpdateBias()
{
   ${P}bias = 0;
   if(${P}highCount >= 2 && ${P}lowCount >= 2) {
      if(${P}lastHigh1 > ${P}lastHigh2 && ${P}lastLow1 > ${P}lastLow2) ${P}bias = 1;
      else if(${P}lastHigh1 < ${P}lastHigh2 && ${P}lastLow1 < ${P}lastLow2) ${P}bias = -1;
   }
}

void ${P}Tick(int scanBars)
{
   ${P}Reset();
   int scan = (int)MathMin((long)scanBars, (long)(iBars(InpSymbol, ${TF}) - ${swingLeft} - 2));
   if(scan < ${swingRight} + 2) return;
   for(int sh = scan; sh >= ${swingRight} + 1; sh--)
      ${P}ScanBar(sh);
   ${P}UpdateBias();
}

bool ${P}IsBull() { return ${P}bias == 1; }
bool ${P}IsBear() { return ${P}bias == -1; }

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }

bool ${P}HasActiveBull() { return ${P}bias == 1; }
bool ${P}HasActiveBear() { return ${P}bias == -1; }

double ${P}ActiveBullSL() { return ${P}lastLow1; }
double ${P}ActiveBearSL() { return ${P}lastHigh1; }
`;
}
