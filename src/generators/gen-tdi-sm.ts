/**
 * Inline Traders Dynamic Index (TDI) State Machine Generator
 *
 * Prefix TDISM — composite of RSI + MAs on RSI + volatility bands on RSI.
 * Does not open trades. Exposes lines, crosses, trend, band states, confirmations.
 *
 * Keep aligned with `tdi-state-module.ts` (visual / Resources twin).
 */

export type TdiMaMethod = "sma" | "ema" | "smma" | "lwma";

function maMethodConst(method: TdiMaMethod): string {
  switch (method) {
    case "ema":
      return "MODE_EMA";
    case "smma":
      return "MODE_SMMA";
    case "lwma":
      return "MODE_LWMA";
    default:
      return "MODE_SMA";
  }
}

function pFloat(params: Record<string, unknown> | undefined, k: string, d: number): number {
  const v = params?.[k];
  return typeof v === "number" && isFinite(v) ? v : d;
}

function pInt(params: Record<string, unknown> | undefined, k: string, d: number): number {
  const v = params?.[k];
  return typeof v === "number" && isFinite(v) ? Math.trunc(v) : d;
}

function pMethod(params: Record<string, unknown> | undefined, k: string, d: TdiMaMethod): TdiMaMethod {
  const v = String(params?.[k] ?? d).toLowerCase();
  if (v === "ema" || v === "smma" || v === "lwma" || v === "sma") return v;
  return d;
}

export function genTdiSm(
  id: string,
  TF: string,
  tf: string,
  params: Record<string, unknown> = {},
): string {
  const P = `TDISM_${id}_`;
  const rsiPeriod = pInt(params, "rsiPeriod", 13);
  const pricePeriod = pInt(params, "rsiPricePeriod", pInt(params, "priceLinePeriod", 2));
  const signalPeriod = pInt(params, "tradeSignalPeriod", pInt(params, "signalPeriod", 7));
  const mblPeriod = pInt(params, "marketBasePeriod", pInt(params, "mblPeriod", 34));
  const vbPeriod = pInt(params, "volatilityBandPeriod", pInt(params, "vbPeriod", 34));
  const vbDev = pFloat(params, "volatilityBandDeviation", pFloat(params, "vbDeviation", 1.6185));
  const neutralTol = pFloat(params, "neutralTolerance", 0.0);
  const minBandWidth = pFloat(params, "minBandWidth", 0.0);
  const priceMethod = maMethodConst(pMethod(params, "rsiPriceMethod", "sma"));
  const signalMethod = maMethodConst(pMethod(params, "tradeSignalMethod", "sma"));
  const mblMethod = maMethodConst(pMethod(params, "marketBaseMethod", "sma"));
  const vbMethod = maMethodConst(pMethod(params, "volatilityBandMethod", "sma"));
  const appliedRaw = String(params.rsiAppliedPrice ?? params.appliedPrice ?? "PRICE_CLOSE").toUpperCase();
  const appliedPrice =
    appliedRaw === "PRICE_OPEN" ||
    appliedRaw === "PRICE_HIGH" ||
    appliedRaw === "PRICE_LOW" ||
    appliedRaw === "PRICE_MEDIAN" ||
    appliedRaw === "PRICE_TYPICAL" ||
    appliedRaw === "PRICE_WEIGHTED"
      ? appliedRaw
      : "PRICE_CLOSE";
  const need =
    Math.max(rsiPeriod, pricePeriod, signalPeriod, mblPeriod, vbPeriod) + signalPeriod + 5;

  return `
//+------------------------------------------------------------------+
//| Traders Dynamic Index SM - ${tf} (${id})                         |
//| RSI + Price/Signal/MBL MAs on RSI + BB-style bands on RSI        |
//+------------------------------------------------------------------+
int      ${P}hRsi = INVALID_HANDLE;
datetime ${P}lastBar = 0;
double   ${P}price = 0.0, ${P}signal = 0.0, ${P}mbl = 0.0;
double   ${P}upper = 0.0, ${P}lower = 0.0, ${P}midBand = 0.0, ${P}bandWidth = 0.0;
double   ${P}prevPrice = 0.0, ${P}prevSignal = 0.0, ${P}prevBandWidth = 0.0;
bool     ${P}bullCross = false, ${P}bearCross = false;
bool     ${P}bullConfirm = false, ${P}bearConfirm = false;
bool     ${P}upperTouch = false, ${P}lowerTouch = false;
bool     ${P}bullTrend = false, ${P}bearTrend = false;
bool     ${P}strongBull = false, ${P}strongBear = false;
bool     ${P}expanding = false, ${P}contracting = false;
int      ${P}rsiPeriod = ${rsiPeriod};
int      ${P}pricePeriod = ${pricePeriod};
int      ${P}signalPeriod = ${signalPeriod};
int      ${P}mblPeriod = ${mblPeriod};
int      ${P}vbPeriod = ${vbPeriod};
double   ${P}vbDev = ${vbDev};
double   ${P}neutralTol = ${neutralTol};
double   ${P}minBandWidth = ${minBandWidth};

void ${P}Reset()
{
   if(${P}hRsi != INVALID_HANDLE) { IndicatorRelease(${P}hRsi); ${P}hRsi = INVALID_HANDLE; }
   ${P}lastBar = 0;
   ${P}price = ${P}signal = ${P}mbl = 0.0;
   ${P}upper = ${P}lower = ${P}midBand = ${P}bandWidth = 0.0;
   ${P}prevPrice = ${P}prevSignal = ${P}prevBandWidth = 0.0;
   ${P}bullCross = ${P}bearCross = false;
   ${P}bullConfirm = ${P}bearConfirm = false;
   ${P}upperTouch = ${P}lowerTouch = false;
   ${P}bullTrend = ${P}bearTrend = false;
   ${P}strongBull = ${P}strongBear = false;
   ${P}expanding = ${P}contracting = false;
}

bool ${P}EnsureRsi()
{
   if(${P}hRsi == INVALID_HANDLE)
      ${P}hRsi = iRSI(InpSymbol, ${TF}, ${P}rsiPeriod, ${appliedPrice});
   return (${P}hRsi != INVALID_HANDLE);
}

double ${P}MaOnSeries(const double &src[], int srcTotal, int shift, int period, ENUM_MA_METHOD method)
{
   if(period < 1 || shift < 0 || shift + period > srcTotal) return 0.0;
   if(method == MODE_EMA)
   {
      double k = 2.0 / (period + 1.0);
      double ema = src[shift + period - 1];
      for(int i = shift + period - 2; i >= shift; i--)
         ema = src[i] * k + ema * (1.0 - k);
      return ema;
   }
   if(method == MODE_SMMA)
   {
      double sum = 0.0;
      for(int i = 0; i < period; i++) sum += src[shift + i];
      double smma = sum / period;
      // Approximate SMMA from oldest→newest within window
      for(int j = period - 2; j >= 0; j--)
         smma = (smma * (period - 1) + src[shift + j]) / period;
      return smma;
   }
   if(method == MODE_LWMA)
   {
      double num = 0.0, den = 0.0;
      for(int i = 0; i < period; i++)
      {
         double w = (double)(period - i);
         num += src[shift + i] * w;
         den += w;
      }
      return (den > 0.0 ? num / den : 0.0);
   }
   // MODE_SMA
   double s = 0.0;
   for(int i = 0; i < period; i++) s += src[shift + i];
   return s / period;
}

double ${P}StdDevOnSeries(const double &src[], int srcTotal, int shift, int period, double mean)
{
   if(period < 2 || shift < 0 || shift + period > srcTotal) return 0.0;
   double acc = 0.0;
   for(int i = 0; i < period; i++)
   {
      double d = src[shift + i] - mean;
      acc += d * d;
   }
   return MathSqrt(acc / period);
}

bool ${P}ComputeAt(int closedShift,
   double &outPrice, double &outSignal, double &outMbl,
   double &outUpper, double &outLower, double &outMid, double &outWidth)
{
   outPrice = outSignal = outMbl = outUpper = outLower = outMid = outWidth = 0.0;
   if(!${P}EnsureRsi()) return false;
   int need = ${need};
   if(BarsCalculated(${P}hRsi) < need + closedShift + 2) return false;
   double rsi[];
   ArraySetAsSeries(rsi, true);
   if(CopyBuffer(${P}hRsi, 0, closedShift, need, rsi) != need) return false;

   // Price line = MA of raw RSI
   outPrice = ${P}MaOnSeries(rsi, need, 0, ${P}pricePeriod, ${priceMethod});

   // Build a short price-line series for signal MA (recompute price line at each offset)
   int sigNeed = ${P}signalPeriod;
   double priceSeries[];
   ArrayResize(priceSeries, sigNeed);
   ArraySetAsSeries(priceSeries, true);
   for(int s = 0; s < sigNeed; s++)
      priceSeries[s] = ${P}MaOnSeries(rsi, need, s, ${P}pricePeriod, ${priceMethod});
   outSignal = ${P}MaOnSeries(priceSeries, sigNeed, 0, ${P}signalPeriod, ${signalMethod});

   outMbl = ${P}MaOnSeries(rsi, need, 0, ${P}mblPeriod, ${mblMethod});
   outMid = ${P}MaOnSeries(rsi, need, 0, ${P}vbPeriod, ${vbMethod});
   double sd = ${P}StdDevOnSeries(rsi, need, 0, ${P}vbPeriod, outMid);
   outUpper = outMid + ${P}vbDev * sd;
   outLower = outMid - ${P}vbDev * sd;
   outWidth = outUpper - outLower;
   return (outPrice > 0.0 && outSignal > 0.0 && outMbl > 0.0);
}

void ${P}ClearEvents()
{
   ${P}bullCross = ${P}bearCross = false;
   ${P}bullConfirm = ${P}bearConfirm = false;
   ${P}upperTouch = ${P}lowerTouch = false;
}

void ${P}UpdateStates()
{
   ${P}bullTrend = (${P}price > ${P}mbl + ${P}neutralTol);
   ${P}bearTrend = (${P}price < ${P}mbl - ${P}neutralTol);
   ${P}strongBull = (${P}price > ${P}signal && ${P}price > ${P}mbl && ${P}signal > ${P}mbl);
   ${P}strongBear = (${P}price < ${P}signal && ${P}price < ${P}mbl && ${P}signal < ${P}mbl);
   bool widthOk = (${P}minBandWidth <= 0.0 || ${P}bandWidth >= ${P}minBandWidth);
   ${P}expanding = widthOk && (${P}bandWidth > ${P}prevBandWidth);
   ${P}contracting = widthOk && (${P}bandWidth < ${P}prevBandWidth);
}

void ${P}Tick(int /*scanBack*/)
{
   ${P}ClearEvents();
   datetime t0 = iTime(InpSymbol, ${TF}, 0);
   if(t0 == 0) return;
   if(t0 == ${P}lastBar) return; // already processed this bar open
   ${P}lastBar = t0;

   double curPrice, curSignal, curMbl, curUpper, curLower, curMid, curWidth;
   double prvPrice, prvSignal, prvMbl, prvUpper, prvLower, prvMid, prvWidth;
   if(!${P}ComputeAt(1, curPrice, curSignal, curMbl, curUpper, curLower, curMid, curWidth)) return;
   if(!${P}ComputeAt(2, prvPrice, prvSignal, prvMbl, prvUpper, prvLower, prvMid, prvWidth)) return;

   ${P}prevPrice = prvPrice;
   ${P}prevSignal = prvSignal;
   ${P}prevBandWidth = prvWidth;

   ${P}price = curPrice;
   ${P}signal = curSignal;
   ${P}mbl = curMbl;
   ${P}upper = curUpper;
   ${P}lower = curLower;
   ${P}midBand = curMid;
   ${P}bandWidth = curWidth;

   // Closed-bar crosses only (bar 1 vs bar 2)
   ${P}bullCross = (prvPrice <= prvSignal && curPrice > curSignal);
   ${P}bearCross = (prvPrice >= prvSignal && curPrice < curSignal);

   ${P}bullConfirm = ${P}bullCross && (curPrice > curMbl) && (curSignal > curMbl);
   ${P}bearConfirm = ${P}bearCross && (curPrice < curMbl) && (curSignal < curMbl);

   ${P}upperTouch = (curPrice >= curUpper);
   ${P}lowerTouch = (curPrice <= curLower);

   ${P}UpdateStates();
}

int    ${P}Trend()              { return (${P}bullTrend ? 1 : (${P}bearTrend ? -1 : 0)); }
bool   ${P}IsBull()             { return ${P}bullTrend; }
bool   ${P}IsBear()             { return ${P}bearTrend; }
bool   ${P}HasActiveBull()      { return ${P}bullTrend || ${P}strongBull; }
bool   ${P}HasActiveBear()      { return ${P}bearTrend || ${P}strongBear; }
bool   ${P}BullJustConfirmed()  { return ${P}bullConfirm; }
bool   ${P}BearJustConfirmed()  { return ${P}bearConfirm; }
double ${P}BullConfirmSL()      { return ${P}lower; }
double ${P}BearConfirmSL()      { return ${P}upper; }
double ${P}ActiveBullSL()       { return ${P}lower; }
double ${P}ActiveBearSL()       { return ${P}upper; }

bool   ${P}BullCross()          { return ${P}bullCross; }
bool   ${P}BearCross()          { return ${P}bearCross; }
bool   ${P}BullConfirmed()      { return ${P}bullConfirm; }
bool   ${P}BearConfirmed()      { return ${P}bearConfirm; }
bool   ${P}StrongBull()         { return ${P}strongBull; }
bool   ${P}StrongBear()         { return ${P}strongBear; }
bool   ${P}BandsExpanding()     { return ${P}expanding; }
bool   ${P}BandsContracting()   { return ${P}contracting; }
bool   ${P}UpperBandTouched()   { return ${P}upperTouch; }
bool   ${P}LowerBandTouched()   { return ${P}lowerTouch; }

double ${P}PriceLine()          { return ${P}price; }
double ${P}SignalLine()         { return ${P}signal; }
double ${P}MarketBaseLine()     { return ${P}mbl; }
double ${P}UpperBand()          { return ${P}upper; }
double ${P}LowerBand()          { return ${P}lower; }
double ${P}BandWidth()          { return ${P}bandWidth; }
`;
}
