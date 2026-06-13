/**
 * Inline Pin Bar State Machine Generator
 *
 * Point-in-time rejection candle on the just-closed bar (shift 1):
 *   Bull pin: lower wick >= wickRatio × range, body <= bodyMaxRatio × range
 *   Bear pin: upper wick >= wickRatio × range, body <= bodyMaxRatio × range
 *
 * Standard API:
 *   PINSM_{id}_Reset()
 *   PINSM_{id}_Tick(scanBack)
 *   PINSM_{id}_BullJustConfirmed() / BearJustConfirmed()
 *   PINSM_{id}_BullConfirmSL() / BearConfirmSL()
 *   PINSM_{id}_HasActiveBull() / HasActiveBear()  — same bar as JustConfirmed (point-in-time)
 */

export function genPinSM(
  id: string,
  TF: string,
  tf: string,
  wickRatio = 0.6,
  bodyMaxRatio = 0.35,
): string {
  const P = `PINSM_${id}_`;

  return `
//+------------------------------------------------------------------+
//| Pin Bar State Machine — ${tf} (${id})                            |
//| Long-wick rejection — hammer / shooting star.                  |
//+------------------------------------------------------------------+
bool      ${P}_bullConfirmed = false;
bool      ${P}_bearConfirmed = false;
double    ${P}_bullSL = 0.0;
double    ${P}_bearSL = 0.0;

void ${P}Reset()
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
}

bool ${P}IsBullPin(int sh)
{
   double o = iOpen (InpSymbol, ${TF}, sh);
   double c = iClose(InpSymbol, ${TF}, sh);
   double h = iHigh (InpSymbol, ${TF}, sh);
   double l = iLow  (InpSymbol, ${TF}, sh);
   double rng = h - l;
   if(rng <= 0.0) return false;
   double body  = MathAbs(c - o);
   double lwick = MathMin(o, c) - l;
   return lwick >= rng * ${wickRatio} && body <= rng * ${bodyMaxRatio};
}

bool ${P}IsBearPin(int sh)
{
   double o = iOpen (InpSymbol, ${TF}, sh);
   double c = iClose(InpSymbol, ${TF}, sh);
   double h = iHigh (InpSymbol, ${TF}, sh);
   double l = iLow  (InpSymbol, ${TF}, sh);
   double rng = h - l;
   if(rng <= 0.0) return false;
   double body  = MathAbs(c - o);
   double uwick = h - MathMax(o, c);
   return uwick >= rng * ${wickRatio} && body <= rng * ${bodyMaxRatio};
}

void ${P}Tick(int scanBack)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   int sh = 1;
   if(${P}IsBullPin(sh))
   {
      ${P}_bullConfirmed = true;
      ${P}_bullSL        = iLow(InpSymbol, ${TF}, sh);
   }
   if(${P}IsBearPin(sh))
   {
      ${P}_bearConfirmed = true;
      ${P}_bearSL        = iHigh(InpSymbol, ${TF}, sh);
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }
bool   ${P}HasActiveBull()     { return ${P}IsBullPin(1); }
bool   ${P}HasActiveBear()     { return ${P}IsBearPin(1); }
double ${P}ActiveBullSL()      { return iLow (InpSymbol, ${TF}, 1); }
double ${P}ActiveBearSL()      { return iHigh(InpSymbol, ${TF}, 1); }
`;
}
