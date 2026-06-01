/**
 * Inline RSI Hidden Divergence State Machine Generator
 *
 * Hidden divergence is a TREND-CONTINUATION setup. SETUP role only — it does
 * not decide direction; it assumes a trend exists and flags continuation pullbacks.
 *
 *   Bullish HD: price Higher Low + RSI Lower Low.
 *   Bearish HD: price Lower High + RSI Higher High.
 *
 * Detection runs on the newest confirmable swing pivot each bar, comparing it
 * to the previous swing of the same kind. RSI is read at the pivot bar.
 *
 * Standard API (identical shape to the other setup SMs):
 *   RSIHDSM_{id}_Reset()
 *   RSIHDSM_{id}_Tick(lookback)
 *   RSIHDSM_{id}_BullJustConfirmed()  — bullish HD detected this bar
 *   RSIHDSM_{id}_BearJustConfirmed()  — bearish HD detected this bar
 *   RSIHDSM_{id}_BullConfirmSL()      — second swing low  (SL for longs)
 *   RSIHDSM_{id}_BearConfirmSL()      — second swing high (SL for shorts)
 *   RSIHDSM_{id}_HasActiveBull()      — a pending bullish HD awaits continuation
 *   RSIHDSM_{id}_HasActiveBear()      — a pending bearish HD awaits continuation
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

  return `
//+------------------------------------------------------------------+
//| RSI Hidden Divergence State Machine — ${tf} (${id})             |
//| Bull HD: price HL + RSI LL.  Bear HD: price LH + RSI HH.        |
//| Trend-continuation SETUP. RSI read at the pivot bar.           |
//+------------------------------------------------------------------+
int    ${P}rsiHandle    = INVALID_HANDLE;
bool   ${P}_bullConfirmed = false;
bool   ${P}_bearConfirmed = false;
double ${P}_bullSL = 0.0;
double ${P}_bearSL = 0.0;
// pending continuation state
bool   ${P}_pendBull = false; double ${P}_pendBullSL = 0.0; int ${P}_pendBullAge = 0;
bool   ${P}_pendBear = false; double ${P}_pendBearSL = 0.0; int ${P}_pendBearAge = 0;

void ${P}Reset()
{
   if(${P}rsiHandle == INVALID_HANDLE)
      ${P}rsiHandle = iRSI(InpSymbol, ${TF}, ${rsiPeriod}, PRICE_CLOSE);
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   ${P}_bullSL = 0.0;
   ${P}_bearSL = 0.0;
   ${P}_pendBull = false; ${P}_pendBullSL = 0.0; ${P}_pendBullAge = 0;
   ${P}_pendBear = false; ${P}_pendBearSL = 0.0; ${P}_pendBearAge = 0;
}

double ${P}RSIv(int sh)
{
   if(${P}rsiHandle == INVALID_HANDLE)
      ${P}rsiHandle = iRSI(InpSymbol, ${TF}, ${rsiPeriod}, PRICE_CLOSE);
   if(${P}rsiHandle == INVALID_HANDLE) return EMPTY_VALUE;
   double _b[];
   if(CopyBuffer(${P}rsiHandle, 0, sh, 1, _b) != 1) return EMPTY_VALUE;
   return _b[0];
}

bool ${P}IsPivotLow(int p, int total)
{
   if(p - ${pivotRight} < 1 || p + ${pivotLeft} >= total) return false;
   double lo = iLow(InpSymbol, ${TF}, p);
   for(int _k = 1; _k <= ${pivotLeft};  _k++) if(iLow(InpSymbol, ${TF}, p + _k) <= lo) return false;
   for(int _k = 1; _k <= ${pivotRight}; _k++) if(iLow(InpSymbol, ${TF}, p - _k) <  lo) return false;
   return true;
}

bool ${P}IsPivotHigh(int p, int total)
{
   if(p - ${pivotRight} < 1 || p + ${pivotLeft} >= total) return false;
   double hi = iHigh(InpSymbol, ${TF}, p);
   for(int _k = 1; _k <= ${pivotLeft};  _k++) if(iHigh(InpSymbol, ${TF}, p + _k) >= hi) return false;
   for(int _k = 1; _k <= ${pivotRight}; _k++) if(iHigh(InpSymbol, ${TF}, p - _k) >  hi) return false;
   return true;
}

// Find the next confirmed pivot low older than 'from'. Returns shift or -1.
int ${P}PrevPivotLow(int from, int lookback, int total)
{
   int limit = MathMin(lookback, total - ${pivotLeft} - 1);
   for(int p = from; p <= limit; p++) if(${P}IsPivotLow(p, total)) return p;
   return -1;
}
int ${P}PrevPivotHigh(int from, int lookback, int total)
{
   int limit = MathMin(lookback, total - ${pivotLeft} - 1);
   for(int p = from; p <= limit; p++) if(${P}IsPivotHigh(p, total)) return p;
   return -1;
}

void ${P}Tick(int lookback)
{
   ${P}_bullConfirmed = false;
   ${P}_bearConfirmed = false;
   int total = iBars(InpSymbol, ${TF});
   int cp = ${pivotRight} + 1;               // newest confirmable pivot shift

   // ── Bullish HD: newest pivot LOW vs the previous pivot LOW ──────────
   if(${P}IsPivotLow(cp, total))
   {
      int prev = ${P}PrevPivotLow(cp + 1, lookback, total);
      if(prev > 0)
      {
         int gap = prev - cp;
         if(gap >= ${minBars} && gap <= ${maxBars})
         {
            double p2 = iLow(InpSymbol, ${TF}, cp),  p1 = iLow(InpSymbol, ${TF}, prev);
            double r2 = ${P}RSIv(cp),                r1 = ${P}RSIv(prev);
            if(r1 != EMPTY_VALUE && r2 != EMPTY_VALUE && p2 > p1 && r2 < r1)
            {
               ${P}_bullConfirmed = true;
               ${P}_bullSL        = p2;
               ${P}_pendBull      = true;
               ${P}_pendBullSL    = p2;
               ${P}_pendBullAge   = 0;
               PrintFormat("[RSIHDSM_${tf}] BULL HD  pL1=%.5f pL2=%.5f  rL1=%.2f rL2=%.2f  SL=%.5f", p1, p2, r1, r2, p2);
            }
         }
      }
   }

   // ── Bearish HD: newest pivot HIGH vs the previous pivot HIGH ────────
   if(${P}IsPivotHigh(cp, total))
   {
      int prev = ${P}PrevPivotHigh(cp + 1, lookback, total);
      if(prev > 0)
      {
         int gap = prev - cp;
         if(gap >= ${minBars} && gap <= ${maxBars})
         {
            double p2 = iHigh(InpSymbol, ${TF}, cp), p1 = iHigh(InpSymbol, ${TF}, prev);
            double r2 = ${P}RSIv(cp),                r1 = ${P}RSIv(prev);
            if(r1 != EMPTY_VALUE && r2 != EMPTY_VALUE && p2 < p1 && r2 > r1)
            {
               ${P}_bearConfirmed = true;
               ${P}_bearSL        = p2;
               ${P}_pendBear      = true;
               ${P}_pendBearSL    = p2;
               ${P}_pendBearAge   = 0;
               PrintFormat("[RSIHDSM_${tf}] BEAR HD  pH1=%.5f pH2=%.5f  rH1=%.2f rH2=%.2f  SL=%.5f", p1, p2, r1, r2, p2);
            }
         }
      }
   }

   // ── Age / invalidate pending continuation setups ───────────────────
   double _c = iClose(InpSymbol, ${TF}, 1);
   if(${P}_pendBull)
   {
      ${P}_pendBullAge++;
      if(_c < ${P}_pendBullSL || ${P}_pendBullAge >= ${expiryBars}) ${P}_pendBull = false;
   }
   if(${P}_pendBear)
   {
      ${P}_pendBearAge++;
      if(_c > ${P}_pendBearSL || ${P}_pendBearAge >= ${expiryBars}) ${P}_pendBear = false;
   }
}

bool   ${P}BullJustConfirmed() { return ${P}_bullConfirmed; }
bool   ${P}BearJustConfirmed() { return ${P}_bearConfirmed; }
double ${P}BullConfirmSL()     { return ${P}_bullSL; }
double ${P}BearConfirmSL()     { return ${P}_bearSL; }
bool   ${P}HasActiveBull()     { return ${P}_pendBull; }
bool   ${P}HasActiveBear()     { return ${P}_pendBear; }
double ${P}ActiveBullSL()      { return ${P}_pendBullSL; }
double ${P}ActiveBearSL()      { return ${P}_pendBearSL; }
`;
}
