/**
 * Phase 2 Traders Dynamic Index State Module — standalone MT5 indicator.
 * Filename: TDI_State_Module.mq5
 *
 * Separate window; exposes TDI lines + event/state buffers for visual QA.
 * Calculation must stay aligned with gen-tdi-sm.ts (EA embed path).
 */

export const TDI_STATE_MODULE_VERSION = "1.0.0";

export function generateTdiStateModule(): string {
  return `//+------------------------------------------------------------------+
//|                                         TDI_State_Module.mq5 |
//| EAbuilder2 verified Traders Dynamic Index state module v${TDI_STATE_MODULE_VERSION} |
//| Separate window · closed-bar events · no trades                |
//+------------------------------------------------------------------+
#property copyright "EAbuilder2"
#property version   "${TDI_STATE_MODULE_VERSION}"
#property indicator_separate_window
#property indicator_buffers 16
#property indicator_plots   5

#property indicator_label1  "RSI Price Line"
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrLime
#property indicator_width1  2

#property indicator_label2  "Trade Signal Line"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrRed
#property indicator_width2  2

#property indicator_label3  "Market Base Line"
#property indicator_type3   DRAW_LINE
#property indicator_color3  clrGold
#property indicator_width3  1

#property indicator_label4  "Upper Volatility Band"
#property indicator_type4   DRAW_LINE
#property indicator_color4  clrDodgerBlue
#property indicator_style4  STYLE_DOT

#property indicator_label5  "Lower Volatility Band"
#property indicator_type5   DRAW_LINE
#property indicator_color5  clrDodgerBlue
#property indicator_style5  STYLE_DOT

input ENUM_TIMEFRAMES InpTF              = PERIOD_CURRENT; // Chart / module TF
input int             InpRsiPeriod       = 13;             // RSI period
input ENUM_APPLIED_PRICE InpRsiPrice     = PRICE_CLOSE;    // RSI applied price
input int             InpPricePeriod     = 2;              // RSI Price Line period
input ENUM_MA_METHOD  InpPriceMethod     = MODE_SMA;       // RSI Price Line method
input int             InpSignalPeriod    = 7;              // Trade Signal Line period
input ENUM_MA_METHOD  InpSignalMethod    = MODE_SMA;       // Trade Signal method
input int             InpMblPeriod       = 34;             // Market Base Line period
input ENUM_MA_METHOD  InpMblMethod       = MODE_SMA;       // Market Base method
input int             InpVbPeriod        = 34;             // Volatility Band period
input double          InpVbDeviation     = 1.6185;         // Volatility Band deviation
input ENUM_MA_METHOD  InpVbMethod        = MODE_SMA;       // Volatility Band middle MA
input double          InpNeutralTol      = 0.0;            // Neutral tolerance (Price vs MBL)
input double          InpMinBandWidth    = 0.0;            // Optional min width for expand/contract
input bool            InpShowLevels      = true;           // Show 32/50/68 levels
input double          InpLevelLow        = 32.0;           // Lower reference level
input double          InpLevelMid        = 50.0;           // Mid reference level
input double          InpLevelHigh       = 68.0;           // Upper reference level
input bool            InpDebugMarkers    = true;           // Cross / confirmation markers

// Plot buffers 0-4
double BufPrice[];
double BufSignal[];
double BufMbl[];
double BufUpper[];
double BufLower[];
// Event / state buffers 5-15 (not plotted)
double BufBullCross[];
double BufBearCross[];
double BufBullTrend[];
double BufBearTrend[];
double BufUpperTouch[];
double BufLowerTouch[];
double BufBandWidth[];
double BufExpand[];
double BufContract[];
double BufBullConfirm[];
double BufBearConfirm[];

int      gRsi = INVALID_HANDLE;
datetime lastBarTime = 0;
string   OBJ_PFX = "TDISM_";

int OnInit()
{
   SetIndexBuffer(0,  BufPrice,       INDICATOR_DATA);
   SetIndexBuffer(1,  BufSignal,      INDICATOR_DATA);
   SetIndexBuffer(2,  BufMbl,         INDICATOR_DATA);
   SetIndexBuffer(3,  BufUpper,       INDICATOR_DATA);
   SetIndexBuffer(4,  BufLower,       INDICATOR_DATA);
   SetIndexBuffer(5,  BufBullCross,   INDICATOR_DATA);
   SetIndexBuffer(6,  BufBearCross,   INDICATOR_DATA);
   SetIndexBuffer(7,  BufBullTrend,   INDICATOR_DATA);
   SetIndexBuffer(8,  BufBearTrend,   INDICATOR_DATA);
   SetIndexBuffer(9,  BufUpperTouch,  INDICATOR_DATA);
   SetIndexBuffer(10, BufLowerTouch,  INDICATOR_DATA);
   SetIndexBuffer(11, BufBandWidth,   INDICATOR_DATA);
   SetIndexBuffer(12, BufExpand,      INDICATOR_DATA);
   SetIndexBuffer(13, BufContract,    INDICATOR_DATA);
   SetIndexBuffer(14, BufBullConfirm, INDICATOR_DATA);
   SetIndexBuffer(15, BufBearConfirm, INDICATOR_DATA);

   ArraySetAsSeries(BufPrice, true);
   ArraySetAsSeries(BufSignal, true);
   ArraySetAsSeries(BufMbl, true);
   ArraySetAsSeries(BufUpper, true);
   ArraySetAsSeries(BufLower, true);
   ArraySetAsSeries(BufBullCross, true);
   ArraySetAsSeries(BufBearCross, true);
   ArraySetAsSeries(BufBullTrend, true);
   ArraySetAsSeries(BufBearTrend, true);
   ArraySetAsSeries(BufUpperTouch, true);
   ArraySetAsSeries(BufLowerTouch, true);
   ArraySetAsSeries(BufBandWidth, true);
   ArraySetAsSeries(BufExpand, true);
   ArraySetAsSeries(BufContract, true);
   ArraySetAsSeries(BufBullConfirm, true);
   ArraySetAsSeries(BufBearConfirm, true);

   IndicatorSetInteger(INDICATOR_DIGITS, 2);
   IndicatorSetString(INDICATOR_SHORTNAME, "TDI State Module");
   if(InpShowLevels)
   {
      IndicatorSetDouble(INDICATOR_LEVELVALUE, 0, InpLevelLow);
      IndicatorSetDouble(INDICATOR_LEVELVALUE, 1, InpLevelMid);
      IndicatorSetDouble(INDICATOR_LEVELVALUE, 2, InpLevelHigh);
      IndicatorSetInteger(INDICATOR_LEVELS, 3);
   }

   gRsi = iRSI(_Symbol, InpTF, InpRsiPeriod, InpRsiPrice);
   if(gRsi == INVALID_HANDLE) return INIT_FAILED;
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(gRsi != INVALID_HANDLE) IndicatorRelease(gRsi);
   ObjectsDeleteAll(0, OBJ_PFX);
}

double MaOnSeries(const double &src[], int srcTotal, int shift, int period, ENUM_MA_METHOD method)
{
   if(period < 1 || shift < 0 || shift + period > srcTotal) return EMPTY_VALUE;
   if(method == MODE_EMA)
   {
      double k = 2.0 / (period + 1.0);
      double ema = src[shift + period - 1];
      for(int i = shift + period - 2; i >= shift; i--)
         ema = src[i] * k + ema * (1.0 - k);
      return ema;
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
      return (den > 0.0 ? num / den : EMPTY_VALUE);
   }
   if(method == MODE_SMMA)
   {
      double sum = 0.0;
      for(int i = 0; i < period; i++) sum += src[shift + i];
      double smma = sum / period;
      for(int j = period - 2; j >= 0; j--)
         smma = (smma * (period - 1) + src[shift + j]) / period;
      return smma;
   }
   double s = 0.0;
   for(int i = 0; i < period; i++) s += src[shift + i];
   return s / period;
}

double StdDevOnSeries(const double &src[], int srcTotal, int shift, int period, double mean)
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

void MarkEvent(const string tag, int sh, color css, int code)
{
   if(!InpDebugMarkers) return;
   string name = OBJ_PFX + tag + "_" + IntegerToString((int)iTime(_Symbol, InpTF, sh));
   if(ObjectFind(0, name) >= 0) ObjectDelete(0, name);
   if(ObjectCreate(0, name, OBJ_ARROW, 0, iTime(_Symbol, InpTF, sh), iClose(_Symbol, InpTF, sh)))
   {
      ObjectSetInteger(0, name, OBJPROP_ARROWCODE, code);
      ObjectSetInteger(0, name, OBJPROP_COLOR, css);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   }
}

int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   int need = MathMax(InpRsiPeriod, MathMax(InpPricePeriod, MathMax(InpSignalPeriod, MathMax(InpMblPeriod, InpVbPeriod)))) + InpSignalPeriod + 5;
   if(rates_total < need + 3) return 0;
   if(BarsCalculated(gRsi) < rates_total) return prev_calculated;

   double rsi[];
   ArraySetAsSeries(rsi, true);
   if(CopyBuffer(gRsi, 0, 0, rates_total, rsi) <= 0) return prev_calculated;

   int start = (prev_calculated == 0) ? rates_total - need - 2 : 1;
   if(start < 1) start = 1;

   // Full rebuild or new closed bar only
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(prev_calculated != 0 && curBar == lastBarTime)
      return rates_total;
   lastBarTime = curBar;

   int from = (prev_calculated == 0) ? rates_total - need - 2 : 2;
   if(from < 1) from = 1;

   for(int sh = from; sh >= 1; sh--)
   {
      double price = MaOnSeries(rsi, rates_total, sh, InpPricePeriod, InpPriceMethod);
      double priceSeries[];
      ArrayResize(priceSeries, InpSignalPeriod);
      ArraySetAsSeries(priceSeries, true);
      bool okSeries = true;
      for(int s = 0; s < InpSignalPeriod; s++)
      {
         priceSeries[s] = MaOnSeries(rsi, rates_total, sh + s, InpPricePeriod, InpPriceMethod);
         if(priceSeries[s] == EMPTY_VALUE) { okSeries = false; break; }
      }
      double signal = okSeries
         ? MaOnSeries(priceSeries, InpSignalPeriod, 0, InpSignalPeriod, InpSignalMethod)
         : EMPTY_VALUE;
      double mbl = MaOnSeries(rsi, rates_total, sh, InpMblPeriod, InpMblMethod);
      double mid = MaOnSeries(rsi, rates_total, sh, InpVbPeriod, InpVbMethod);
      double sd = StdDevOnSeries(rsi, rates_total, sh, InpVbPeriod, mid);
      double upper = mid + InpVbDeviation * sd;
      double lower = mid - InpVbDeviation * sd;
      double width = upper - lower;

      BufPrice[sh] = price;
      BufSignal[sh] = signal;
      BufMbl[sh] = mbl;
      BufUpper[sh] = upper;
      BufLower[sh] = lower;
      BufBandWidth[sh] = width;
      BufBullTrend[sh] = (price != EMPTY_VALUE && mbl != EMPTY_VALUE && price > mbl + InpNeutralTol) ? 1.0 : 0.0;
      BufBearTrend[sh] = (price != EMPTY_VALUE && mbl != EMPTY_VALUE && price < mbl - InpNeutralTol) ? 1.0 : 0.0;
      BufUpperTouch[sh] = (price != EMPTY_VALUE && price >= upper) ? 1.0 : 0.0;
      BufLowerTouch[sh] = (price != EMPTY_VALUE && price <= lower) ? 1.0 : 0.0;
      BufBullCross[sh] = 0.0;
      BufBearCross[sh] = 0.0;
      BufBullConfirm[sh] = 0.0;
      BufBearConfirm[sh] = 0.0;
      BufExpand[sh] = 0.0;
      BufContract[sh] = 0.0;
   }

   // Events on closed candles only (compare sh vs sh+1); never on forming bar 0
   for(int sh = from; sh >= 1; sh--)
   {
      if(sh + 1 >= rates_total) continue;
      double p0 = BufPrice[sh], s0 = BufSignal[sh], m0 = BufMbl[sh];
      double p1 = BufPrice[sh + 1], s1 = BufSignal[sh + 1];
      if(p0 == EMPTY_VALUE || s0 == EMPTY_VALUE || p1 == EMPTY_VALUE || s1 == EMPTY_VALUE) continue;

      bool bullX = (p1 <= s1 && p0 > s0);
      bool bearX = (p1 >= s1 && p0 < s0);
      BufBullCross[sh] = bullX ? 1.0 : 0.0;
      BufBearCross[sh] = bearX ? 1.0 : 0.0;
      BufBullConfirm[sh] = (bullX && p0 > m0 && s0 > m0) ? 1.0 : 0.0;
      BufBearConfirm[sh] = (bearX && p0 < m0 && s0 < m0) ? 1.0 : 0.0;

      double w0 = BufBandWidth[sh], w1 = BufBandWidth[sh + 1];
      bool widthOk = (InpMinBandWidth <= 0.0 || w0 >= InpMinBandWidth);
      BufExpand[sh] = (widthOk && w0 > w1) ? 1.0 : 0.0;
      BufContract[sh] = (widthOk && w0 < w1) ? 1.0 : 0.0;

      if(sh == 1)
      {
         if(bullX) MarkEvent("BX", sh, clrLime, 233);
         if(bearX) MarkEvent("SX", sh, clrRed, 234);
         if(BufBullConfirm[sh] > 0.0) MarkEvent("BC", sh, clrAqua, 241);
         if(BufBearConfirm[sh] > 0.0) MarkEvent("SC", sh, clrMagenta, 242);
      }
   }

   // Forming bar visual only — no events
   if(rates_total > need)
   {
      BufPrice[0] = MaOnSeries(rsi, rates_total, 0, InpPricePeriod, InpPriceMethod);
      // leave event buffers at 0 on bar 0
      BufBullCross[0] = BufBearCross[0] = 0.0;
      BufBullConfirm[0] = BufBearConfirm[0] = 0.0;
   }

   return rates_total;
}
`;
}

/** Phase 1 alias — same visual module (TDI is already a full indicator). */
export function generateTdiDetector(): string {
  return generateTdiStateModule();
}
