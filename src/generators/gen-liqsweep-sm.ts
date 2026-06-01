/**
 * Inline Liquidity Sweep State Machine Generator
 *
 * Detects when a wick sweeps a swing extreme then closes back — the
 * confirmation IS the signal (no separate retest phase needed).
 *
 * Standard API:
 *   LSSM_{id}_Reset()
 *   LSSM_{id}_Tick(lookback)
 *   LSSM_{id}_BullJustConfirmed()   — bull sweep confirmed this bar
 *   LSSM_{id}_BearJustConfirmed()   — bear sweep confirmed this bar
 *   LSSM_{id}_BullConfirmSL()       — wick low of sweep bar
 *   LSSM_{id}_BearConfirmSL()       — wick high of sweep bar
 */

export function genLiqSweepSM(
  id: string,
  TF: string,
  tf: string,
  swingLen = 3, // bars each side to confirm swing pivot
  lookback = 20, // bars to scan for swing levels
  maxWait = 5, // bars to wait for close-back after wick
): string {
  const P = `LSSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| LiqSweep State Machine — ${tf} (${id})                         |
//| Sweep wick beyond swing + close-back → CONFIRMED               |
//+------------------------------------------------------------------+
struct ${P}SwingLvl
{
   int      dir;        //  1=high  -1=low
   double   price;
   datetime barTime;
   bool     consumed;
};
struct ${P}SweepRec
{
   int      dir;         //  1=bull sweep (below swing low)  -1=bear sweep (above swing high)
   double   sweepExtreme;// wick low (bull) or wick high (bear)
   double   swingLevel;
   datetime sweepTime;
   int      waitBars;
   bool     confirmed;
   bool     justConfirmed;
};

#define ${P}MAX_SWINGS  50
#define ${P}MAX_SWEEPS  30

${P}SwingLvl  ${P}swings[${P}MAX_SWINGS];
${P}SweepRec  ${P}sweeps[${P}MAX_SWEEPS];
int           ${P}swingCount  = 0;
int           ${P}sweepCount  = 0;
bool          ${P}_bullConf   = false;
bool          ${P}_bearConf   = false;
double        ${P}_bullSL     = 0.0;
double        ${P}_bearSL     = 0.0;

void ${P}Reset()
{
   ${P}swingCount = 0;
   ${P}sweepCount = 0;
   ${P}_bullConf  = false;
   ${P}_bearConf  = false;
}

void ${P}DetectSwing(int sh, int total)
{
   if(sh + ${swingLen} >= total || sh < ${swingLen}) return;
   datetime t = iTime(InpSymbol, ${TF}, sh);
   for(int _k=0;_k<${P}swingCount;_k++)
      if(${P}swings[_k].barTime == t) return;

   double hi = iHigh(InpSymbol, ${TF}, sh);
   double lo = iLow (InpSymbol, ${TF}, sh);
   bool isHi = true, isLo = true;
   for(int _j = sh - ${swingLen}; _j <= sh + ${swingLen}; _j++)
   {
      if(_j == sh) continue;
      if(iHigh(InpSymbol,${TF},_j) >= hi) isHi = false;
      if(iLow (InpSymbol,${TF},_j) <= lo) isLo = false;
   }
   if(!isHi && !isLo) return;
   if(${P}swingCount >= ${P}MAX_SWINGS)
   {
      for(int _k=0;_k<${P}swingCount-1;_k++) ${P}swings[_k]=${P}swings[_k+1];
      ${P}swingCount--;
   }
   ${P}swings[${P}swingCount].dir      = isHi ? 1 : -1;
   ${P}swings[${P}swingCount].price    = isHi ? hi : lo;
   ${P}swings[${P}swingCount].barTime  = t;
   ${P}swings[${P}swingCount].consumed = false;
   ${P}swingCount++;
}

void ${P}CheckSweep(int sh)
{
   double wickHi = iHigh (InpSymbol, ${TF}, sh);
   double wickLo = iLow  (InpSymbol, ${TF}, sh);
   double cl     = iClose(InpSymbol, ${TF}, sh);

   for(int _k=0;_k<${P}swingCount;_k++)
   {
      if(${P}swings[_k].consumed) continue;
      if(${P}swings[_k].dir == 1)  // swing HIGH
      {
         if(wickHi > ${P}swings[_k].price && cl < ${P}swings[_k].price)
         {
            ${P}swings[_k].consumed = true;
            if(${P}sweepCount >= ${P}MAX_SWEEPS) continue;
            ${P}sweeps[${P}sweepCount].dir           = -1;  // bear sweep
            ${P}sweeps[${P}sweepCount].sweepExtreme   = wickHi;
            ${P}sweeps[${P}sweepCount].swingLevel     = ${P}swings[_k].price;
            ${P}sweeps[${P}sweepCount].sweepTime      = iTime(InpSymbol,${TF},sh);
            ${P}sweeps[${P}sweepCount].waitBars       = 0;
            ${P}sweeps[${P}sweepCount].confirmed      = true;
            ${P}sweeps[${P}sweepCount].justConfirmed  = true;
            ${P}sweepCount++;
            ${P}_bearConf = true;
            ${P}_bearSL   = wickHi;
            PrintFormat("[LSSM_${tf}] BEAR SWEEP level=%.5f SL=%.5f", ${P}swings[_k].price, wickHi);
         }
      }
      else  // swing LOW
      {
         if(wickLo < ${P}swings[_k].price && cl > ${P}swings[_k].price)
         {
            ${P}swings[_k].consumed = true;
            if(${P}sweepCount >= ${P}MAX_SWEEPS) continue;
            ${P}sweeps[${P}sweepCount].dir           = 1;  // bull sweep
            ${P}sweeps[${P}sweepCount].sweepExtreme   = wickLo;
            ${P}sweeps[${P}sweepCount].swingLevel     = ${P}swings[_k].price;
            ${P}sweeps[${P}sweepCount].sweepTime      = iTime(InpSymbol,${TF},sh);
            ${P}sweeps[${P}sweepCount].waitBars       = 0;
            ${P}sweeps[${P}sweepCount].confirmed      = true;
            ${P}sweeps[${P}sweepCount].justConfirmed  = true;
            ${P}sweepCount++;
            ${P}_bullConf = true;
            ${P}_bullSL   = wickLo;
            PrintFormat("[LSSM_${tf}] BULL SWEEP level=%.5f SL=%.5f", ${P}swings[_k].price, wickLo);
         }
      }
   }
}

void ${P}Tick(int lb)
{
   ${P}_bullConf = false;
   ${P}_bearConf = false;
   int total = iBars(InpSymbol, ${TF});
   for(int sh = lb + ${swingLen}; sh >= ${swingLen} + 1; sh--)
      ${P}DetectSwing(sh, total);
   ${P}CheckSweep(1);
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConf; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConf; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }
`;
}
