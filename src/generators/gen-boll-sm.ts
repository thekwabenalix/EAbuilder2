/**
 * Inline Bollinger Bands State Machine Generator
 *
 * Prefix BOLLSM — NOT BBSM (SMC Breaker Block).
 *
 * Modes (param mode):
 *   touch    — lower-band rejection = bull, upper-band rejection = bear (default execution)
 *   breakout — close above upper = bull, close below lower = bear
 *   midline  — bias from close vs midline (direction / setup)
 *
 * iBands buffers: 0=mid, 1=upper, 2=lower
 *
 * Standard API:
 *   BOLLSM_{id}_Reset()
 *   BOLLSM_{id}_Tick(scanBack)
 *   BOLLSM_{id}_IsBull() / IsBear()           — midline bias (bar 1)
 *   BOLLSM_{id}_HasActiveBull() / HasActiveBear()
 *   BOLLSM_{id}_BullJustConfirmed() / BearJustConfirmed()
 *   BOLLSM_{id}_BullConfirmSL() / BearConfirmSL()
 *   BOLLSM_{id}_ActiveBullSL() / ActiveBearSL() — midline SL hint
 */

export type BollSmMode = "touch" | "breakout" | "midline";

export function genBollSm(
  id: string,
  TF: string,
  tf: string,
  period = 20,
  deviation = 2,
  mode: BollSmMode = "touch",
): string {
  const P = `BOLLSM_${id}_`;
  const modeBreak = mode === "breakout";

  const bullConfirmLogic = modeBreak
    ? `(${P}_c1 > ${P}_up)`
    : `(${P}_l1 <= ${P}_lo && ${P}_c1 > ${P}_lo)`;
  const bearConfirmLogic = modeBreak
    ? `(${P}_c1 < ${P}_lo)`
    : `(${P}_h1 >= ${P}_up && ${P}_c1 < ${P}_up)`;

  return `
//+------------------------------------------------------------------+
//| Bollinger Bands SM — ${tf} (${id}) mode=${mode}                 |
//+------------------------------------------------------------------+
int      ${P}hBands = INVALID_HANDLE;
double   ${P}_mid = 0.0, ${P}_up = 0.0, ${P}_lo = 0.0;
double   ${P}_c1 = 0.0, ${P}_h1 = 0.0, ${P}_l1 = 0.0;
bool     ${P}_bullConfirmed = false;
bool     ${P}_bearConfirmed = false;
double   ${P}_bullSL = 0.0;
double   ${P}_bearSL = 0.0;

void ${P}Reset()
{
   if(${P}hBands != INVALID_HANDLE) { IndicatorRelease(${P}hBands); ${P}hBands = INVALID_HANDLE; }
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

bool ${P}EnsureBands()
{
   if(${P}hBands == INVALID_HANDLE)
      ${P}hBands = iBands(InpSymbol, ${TF}, ${period}, 0, ${deviation}, PRICE_CLOSE);
   return (${P}hBands != INVALID_HANDLE);
}

double ${P}Band(int buf, int sh)
{
   if(!${P}EnsureBands()) return 0.0;
   double arr[1];
   if(CopyBuffer(${P}hBands, buf, sh, 1, arr) != 1) return 0.0;
   return arr[0];
}

void ${P}ReadBar1()
{
   ${P}_mid = ${P}Band(0, 1);
   ${P}_up  = ${P}Band(1, 1);
   ${P}_lo  = ${P}Band(2, 1);
   ${P}_c1  = iClose(InpSymbol, ${TF}, 1);
   ${P}_h1  = iHigh (InpSymbol, ${TF}, 1);
   ${P}_l1  = iLow  (InpSymbol, ${TF}, 1);
}

void ${P}Tick(int scanBack)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   if(!${P}EnsureBands()) return;
   ${P}ReadBar1();
   if(${P}_mid <= 0.0 || ${P}_up <= 0.0 || ${P}_lo <= 0.0) return;
   if(${bullConfirmLogic})
   {
      ${P}_bullConfirmed = true;
      ${P}_bullSL        = ${P}_l1;
   }
   if(${bearConfirmLogic})
   {
      ${P}_bearConfirmed = true;
      ${P}_bearSL        = ${P}_h1;
   }
}

bool   ${P}IsBull()             { ${P}ReadBar1(); return (${P}_mid > 0.0 && ${P}_c1 > ${P}_mid); }
bool   ${P}IsBear()             { ${P}ReadBar1(); return (${P}_mid > 0.0 && ${P}_c1 < ${P}_mid); }
bool   ${P}BullJustConfirmed()  { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed()  { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()      { return ${P}_bullSL; }
double ${P}BearConfirmSL()      { return ${P}_bearSL; }
bool   ${P}HasActiveBull()      { return ${P}IsBull(); }
bool   ${P}HasActiveBear()      { return ${P}IsBear(); }
double ${P}ActiveBullSL()       { ${P}ReadBar1(); return ${P}_mid; }
double ${P}ActiveBearSL()       { ${P}ReadBar1(); return ${P}_mid; }
`;
}
