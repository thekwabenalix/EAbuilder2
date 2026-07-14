/**
 * Phase 2 Traders Dynamic Index State Module — standalone MT5 indicator.
 * Filename: TDI_State_Module.mq5
 *
 * Aligned with LazyBear / TradingView TDI:
 *   Price Line  = MA(RSI, pricePeriod)
 *   Signal Line = MA(RSI, signalPeriod)   // both MAs on raw RSI, not MA-of-MA
 *   MBL / bands = MA/StdDev of RSI
 *
 * Forming bar (shift 0) is display-only and always fully filled so the
 * subwindow scale does not collapse to 0.00 on the live candle.
 * Cross / confirmation events fire on closed bars only.
 */

export const TDI_STATE_MODULE_VERSION = "1.0.1";

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
#property indicator_minimum 0
#property indicator_maximum 100

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
#property indicator_width3  2

#property indicator_label4  "Upper Volatility Band"
#property indicator_type4   DRAW_LINE
#property indicator_color4  clrDodgerBlue
#property indicator_style4  STYLE_DOT
#property indicator_width4  1

#property indicator_label5  "Lower Volatility Band"
#property indicator_type5   DRAW_LINE
#property indicator_color5  clrDodgerBlue
#property indicator_style5  STYLE_DOT
#property indicator_width5  1

input ENUM_TIMEFRAMES InpTF              = PERIOD_CURRENT; // Chart / module TF
input int             InpRsiPeriod       = 13;             // RSI period
input ENUM_APPLIED_PRICE InpRsiPrice     = PRICE_CLOSE;    // RSI applied price
input int             InpPricePeriod     = 2;              // RSI Price Line MA period (green)
input ENUM_MA_METHOD  InpPriceMethod     = MODE_SMA;       // RSI Price Line method
input int             InpSignalPeriod    = 7;              // Trade Signal Line MA period (red)
input ENUM_MA_METHOD  InpSignalMethod    = MODE_SMA;       // Trade Signal method
input int             InpMblPeriod       = 34;             // Market Base Line period (yellow)
input ENUM_MA_METHOD  InpMblMethod       = MODE_SMA;       // Market Base method
input int             InpVbPeriod        = 34;             // Volatility Band period
input double          InpVbDeviation     = 1.6185;         // Volatility Band deviation
input ENUM_MA_METHOD  InpVbMethod        = MODE_SMA;       // Volatility Band middle MA
input double          InpNeutralTol      = 0.0;            // Neutral tolerance (Price vs MBL)
input double          InpMinBandWidth    = 0.0;            // Optional min width for expand/contract
input bool            InpShowLevels      = true;           // Show reference levels
input double          InpLevelLow        = 32.0;           // Lower reference level
input double          InpLevelMid        = 50.0;           // Mid reference level
input double          InpLevelHigh       = 68.0;           // Upper reference level
input bool            InpDebugMarkers    = true;           // Cross / confirmation markers

double BufPrice[];
double BufSignal[];
double BufMbl[];
double BufUpper[];
double BufLower[];
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
   SetIndexBuffer(5,  BufBullCross,   INDICATOR_CALCULATIONS);
   SetIndexBuffer(6,  BufBearCross,   INDICATOR_CALCULATIONS);
   SetIndexBuffer(7,  BufBullTrend,   INDICATOR_CALCULATIONS);
   SetIndexBuffer(8,  BufBearTrend,   INDICATOR_CALCULATIONS);
   SetIndexBuffer(9,  BufUpperTouch,  INDICATOR_CALCULATIONS);
   SetIndexBuffer(10, BufLowerTouch,  INDICATOR_CALCULATIONS);
   SetIndexBuffer(11, BufBandWidth,   INDICATOR_CALCULATIONS);
   SetIndexBuffer(12, BufExpand,      INDICATOR_CALCULATIONS);
   SetIndexBuffer(13, BufContract,    INDICATOR_CALCULATIONS);
   SetIndexBuffer(14, BufBullConfirm, INDICATOR_CALCULATIONS);
   SetIndexBuffer(15, BufBearConfirm, INDICATOR_CALCULATIONS);

   for(int p = 0; p < 5; p++)
      PlotIndexSetDouble(p, PLOT_EMPTY_VALUE, EMPTY_VALUE);

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
      IndicatorSetInteger(INDICATOR_LEVELS, 3);
      IndicatorSetDouble(INDICATOR_LEVELVALUE, 0, InpLevelLow);
      IndicatorSetDouble(INDICATOR_LEVELVALUE, 1, InpLevelMid);
      IndicatorSetDouble(INDICATOR_LEVELVALUE, 2, InpLevelHigh);
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
   if(period < 2 || shift < 0 || shift + period > srcTotal || mean == EMPTY_VALUE) return 0.0;
   double acc = 0.0;
   for(int i = 0; i < period; i++)
   {
      double d = src[shift + i] - mean;
      acc += d * d;
   }
   return MathSqrt(acc / period);
}

void ClearEventsAt(int sh)
{
   BufBullCross[sh] = 0.0;
   BufBearCross[sh] = 0.0;
   BufBullConfirm[sh] = 0.0;
   BufBearConfirm[sh] = 0.0;
   BufExpand[sh] = 0.0;
   BufContract[sh] = 0.0;
}

void FillLinesAt(int sh, const double &rsi[], int rsiTotal)
{
   // LazyBear / TV: Price + Signal are both MAs of raw RSI (not MA-of-MA).
   double price  = MaOnSeries(rsi, rsiTotal, sh, InpPricePeriod,  InpPriceMethod);
   double signal = MaOnSeries(rsi, rsiTotal, sh, InpSignalPeriod, InpSignalMethod);
   double mbl    = MaOnSeries(rsi, rsiTotal, sh, InpMblPeriod,    InpMblMethod);
   double mid    = MaOnSeries(rsi, rsiTotal, sh, InpVbPeriod,     InpVbMethod);

   if(price == EMPTY_VALUE || signal == EMPTY_VALUE || mbl == EMPTY_VALUE || mid == EMPTY_VALUE)
   {
      BufPrice[sh] = BufSignal[sh] = BufMbl[sh] = BufUpper[sh] = BufLower[sh] = EMPTY_VALUE;
      BufBandWidth[sh] = EMPTY_VALUE;
      BufBullTrend[sh] = BufBearTrend[sh] = 0.0;
      BufUpperTouch[sh] = BufLowerTouch[sh] = 0.0;
      ClearEventsAt(sh);
      return;
   }

   double sd = StdDevOnSeries(rsi, rsiTotal, sh, InpVbPeriod, mid);
   double upper = mid + InpVbDeviation * sd;
   double lower = mid - InpVbDeviation * sd;

   BufPrice[sh] = price;
   BufSignal[sh] = signal;
   BufMbl[sh] = mbl;
   BufUpper[sh] = upper;
   BufLower[sh] = lower;
   BufBandWidth[sh] = upper - lower;
   BufBullTrend[sh] = (price > mbl + InpNeutralTol) ? 1.0 : 0.0;
   BufBearTrend[sh] = (price < mbl - InpNeutralTol) ? 1.0 : 0.0;
   BufUpperTouch[sh] = (price >= upper) ? 1.0 : 0.0;
   BufLowerTouch[sh] = (price <= lower) ? 1.0 : 0.0;
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
   int need = MathMax(InpRsiPeriod,
               MathMax(InpPricePeriod,
               MathMax(InpSignalPeriod,
               MathMax(InpMblPeriod, InpVbPeriod)))) + 5;
   if(rates_total < need + 3) return 0;
   if(BarsCalculated(gRsi) < rates_total) return prev_calculated;

   double rsi[];
   ArraySetAsSeries(rsi, true);
   if(CopyBuffer(gRsi, 0, 0, rates_total, rsi) <= 0) return prev_calculated;

   datetime curBar = iTime(_Symbol, InpTF, 0);
   bool newBar = (prev_calculated == 0) || (curBar != lastBarTime);
   if(newBar) lastBarTime = curBar;

   // Rebuild closed history on first run / new bar; always refresh forming bar for display.
   int from = (prev_calculated == 0) ? rates_total - need - 2 : (newBar ? 2 : 0);
   if(from < 0) from = 0;

   for(int sh = from; sh >= 0; sh--)
   {
      FillLinesAt(sh, rsi, rates_total);
      ClearEventsAt(sh); // events filled below for closed bars only
   }

   if(newBar || prev_calculated == 0)
   {
      int evFrom = (prev_calculated == 0) ? rates_total - need - 2 : 2;
      if(evFrom < 1) evFrom = 1;
      for(int sh = evFrom; sh >= 1; sh--)
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
         if(w0 != EMPTY_VALUE && w1 != EMPTY_VALUE)
         {
            bool widthOk = (InpMinBandWidth <= 0.0 || w0 >= InpMinBandWidth);
            BufExpand[sh] = (widthOk && w0 > w1) ? 1.0 : 0.0;
            BufContract[sh] = (widthOk && w0 < w1) ? 1.0 : 0.0;
         }

         if(sh == 1)
         {
            if(bullX) MarkEvent("BX", sh, clrLime, 233);
            if(bearX) MarkEvent("SX", sh, clrRed, 234);
            if(BufBullConfirm[sh] > 0.0) MarkEvent("BC", sh, clrAqua, 241);
            if(BufBearConfirm[sh] > 0.0) MarkEvent("SC", sh, clrMagenta, 242);
         }
      }
   }

   // Forming candle: lines only — never fire events
   ClearEventsAt(0);
   return rates_total;
}
`;
}

/** Phase 1 alias — same visual module (TDI is already a full indicator). */
export function generateTdiDetector(): string {
  return generateTdiStateModule();
}
