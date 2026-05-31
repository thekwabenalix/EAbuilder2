/**
 * Indicator Module — RSI Hidden Divergence Detector (Phase 1) v1.1.0
 *
 * Trend-CONTINUATION setup. SETUP role only (does not decide direction).
 *
 * Bullish HD: price Higher Low + RSI Lower Low.
 * Bearish HD: price Lower High + RSI Higher High.
 *
 * Renders in its OWN sub-window: plots the RSI line (with 30/70 guides),
 * draws the RSI divergence line in the sub-window AND the price divergence
 * line on the main chart so both legs are visible (as in the playbook).
 *
 * Buffers (iCustom):
 *   0 : RSIPlotBuf       — the RSI line (plotted)
 *   1 : BullHiddenDivBuf — 1.0 at the second (newer) swing low
 *   2 : BearHiddenDivBuf — 1.0 at the second (newer) swing high
 */

export const RSI_HD_DETECTOR_VERSION = "1.1.0";
export const RSI_HD_DETECTOR_MODULE  = "RSI_Hidden_Divergence_Detector";

export function generateRsiHiddenDivergenceDetector(): string {
  return `//+------------------------------------------------------------------+
//| RSI_Hidden_Divergence_Detector.mq5                            |
//| Indicator Module v${RSI_HD_DETECTOR_VERSION} — RSI Hidden Divergence (Setup)|
//|                                                                  |
//| Separate window: plots RSI + draws divergence on BOTH panes.   |
//| Bullish HD: price HL + RSI LL. Bearish HD: price LH + RSI HH.   |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Indicator Module"
#property version   "1.10"
#property strict
#property indicator_separate_window
#property indicator_buffers 3
#property indicator_plots   1
#property indicator_minimum 0
#property indicator_maximum 100

//--- plot RSI
#property indicator_label1  "RSI"
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrDodgerBlue
#property indicator_width1  1

double RSIPlotBuf[];        // plotted RSI line  (buffer 0)
double BullHiddenDivBuf[];  // signal            (buffer 1)
double BearHiddenDivBuf[];  // signal            (buffer 2)

#define OBJ_PREFIX "RSIHD_"

//--- Inputs
input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT; // Timeframe
input int             InpLookback   = 500;            // Bars to scan
input int             InpRSIPeriod  = 14;             // RSI period
input int             InpPivotLeft  = 3;              // Pivot strength (older side)
input int             InpPivotRight = 3;              // Pivot strength (newer side)
input int             InpMinBars    = 5;              // Min bars between the two swings
input int             InpMaxBars    = 50;            // Max bars between the two swings
input int             InpLineWidth  = 2;              // Divergence line width
input int             InpFontSize   = 8;              // Label font size
input color           InpBullColor  = clrMediumSeaGreen; // Bullish HD
input color           InpBearColor  = clrTomato;          // Bearish HD
input bool            InpShowLog     = true;          // Print events to journal

int      gRSI = INVALID_HANDLE;
int      gWin = -1;            // this indicator's sub-window index
datetime lastBarTime = 0;
int      gObjCnt = 0;

// Rolling last confirmed swing low / high (price + RSI + time)
bool     gHasLow  = false; double gLowPrice  = 0, gLowRSI  = 0; datetime gLowTime  = 0;
bool     gHasHigh = false; double gHighPrice = 0, gHighRSI = 0; datetime gHighTime = 0;

//+------------------------------------------------------------------+
double RSIv(int sh)
{
   double b[];
   if(CopyBuffer(gRSI, 0, sh, 1, b) != 1) return EMPTY_VALUE;
   return b[0];
}

bool IsPivotLow(int p)
{
   int bars = iBars(_Symbol, InpTF);
   if(p - InpPivotRight < 0 || p + InpPivotLeft >= bars) return false;
   double lo = iLow(_Symbol, InpTF, p);
   for(int k = 1; k <= InpPivotLeft;  k++) if(iLow(_Symbol, InpTF, p + k) <= lo) return false;
   for(int k = 1; k <= InpPivotRight; k++) if(iLow(_Symbol, InpTF, p - k) <  lo) return false;
   return true;
}

bool IsPivotHigh(int p)
{
   int bars = iBars(_Symbol, InpTF);
   if(p - InpPivotRight < 0 || p + InpPivotLeft >= bars) return false;
   double hi = iHigh(_Symbol, InpTF, p);
   for(int k = 1; k <= InpPivotLeft;  k++) if(iHigh(_Symbol, InpTF, p + k) >= hi) return false;
   for(int k = 1; k <= InpPivotRight; k++) if(iHigh(_Symbol, InpTF, p - k) >  hi) return false;
   return true;
}

//+------------------------------------------------------------------+
// Price line on main chart (window 0) + RSI line in sub-window (gWin) + label.
void DrawDivergence(int dir, datetime t1, double price1, double rsi1,
                    datetime t2, double price2, double rsi2)
{
   color c = (dir > 0) ? InpBullColor : InpBearColor;
   string id = IntegerToString(gObjCnt); gObjCnt++;

   string pl = OBJ_PREFIX + id + "_pl";   // price line (main chart)
   if(ObjectCreate(0, pl, OBJ_TREND, 0, t1, price1, t2, price2))
   {
      ObjectSetInteger(0, pl, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, pl, OBJPROP_WIDTH,      InpLineWidth);
      ObjectSetInteger(0, pl, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, pl, OBJPROP_SELECTABLE, false);
   }
   string plb = OBJ_PREFIX + id + "_pb";  // price label (main chart)
   if(ObjectCreate(0, plb, OBJ_TEXT, 0, t2, price2))
   {
      ObjectSetString (0, plb, OBJPROP_TEXT,       dir > 0 ? "Bull HD" : "Bear HD");
      ObjectSetInteger(0, plb, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, plb, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, plb, OBJPROP_ANCHOR,     dir > 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, plb, OBJPROP_SELECTABLE, false);
   }

   // RSI line in this indicator's sub-window
   if(gWin >= 0)
   {
      string rl = OBJ_PREFIX + id + "_rl";
      if(ObjectCreate(0, rl, OBJ_TREND, gWin, t1, rsi1, t2, rsi2))
      {
         ObjectSetInteger(0, rl, OBJPROP_COLOR,      c);
         ObjectSetInteger(0, rl, OBJPROP_WIDTH,      InpLineWidth);
         ObjectSetInteger(0, rl, OBJPROP_RAY_RIGHT,  false);
         ObjectSetInteger(0, rl, OBJPROP_SELECTABLE, false);
      }
   }
}

//+------------------------------------------------------------------+
void ProcessPivots(int sh)
{
   int p = sh + InpPivotRight;
   int bufN = ArraySize(BullHiddenDivBuf);

   if(IsPivotLow(p))
   {
      double price = iLow(_Symbol, InpTF, p);
      double rsi   = RSIv(p);
      datetime tp  = iTime(_Symbol, InpTF, p);
      if(gHasLow && rsi != EMPTY_VALUE)
      {
         int gap = iBarShift(_Symbol, InpTF, gLowTime) - p;
         if(gap >= InpMinBars && gap <= InpMaxBars && price > gLowPrice && rsi < gLowRSI)
         {
            if(p < bufN) BullHiddenDivBuf[p] = 1.0;
            DrawDivergence(1, gLowTime, gLowPrice, gLowRSI, tp, price, rsi);
            if(InpShowLog)
               PrintFormat("RSI_HD_BULL | pL1=%.5f pL2=%.5f | rL1=%.2f rL2=%.2f | %s",
                  gLowPrice, price, gLowRSI, rsi, TimeToString(tp, TIME_DATE|TIME_MINUTES));
         }
      }
      if(rsi != EMPTY_VALUE) { gLowPrice = price; gLowRSI = rsi; gLowTime = tp; gHasLow = true; }
   }

   if(IsPivotHigh(p))
   {
      double price = iHigh(_Symbol, InpTF, p);
      double rsi   = RSIv(p);
      datetime tp  = iTime(_Symbol, InpTF, p);
      if(gHasHigh && rsi != EMPTY_VALUE)
      {
         int gap = iBarShift(_Symbol, InpTF, gHighTime) - p;
         if(gap >= InpMinBars && gap <= InpMaxBars && price < gHighPrice && rsi > gHighRSI)
         {
            if(p < bufN) BearHiddenDivBuf[p] = 1.0;
            DrawDivergence(-1, gHighTime, gHighPrice, gHighRSI, tp, price, rsi);
            if(InpShowLog)
               PrintFormat("RSI_HD_BEAR | pH1=%.5f pH2=%.5f | rH1=%.2f rH2=%.2f | %s",
                  gHighPrice, price, gHighRSI, rsi, TimeToString(tp, TIME_DATE|TIME_MINUTES));
         }
      }
      if(rsi != EMPTY_VALUE) { gHighPrice = price; gHighRSI = rsi; gHighTime = tp; gHasHigh = true; }
   }
}

//+------------------------------------------------------------------+
void ResetState()
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   gObjCnt = 0;
   gHasLow = false; gHasHigh = false;
   ArrayInitialize(BullHiddenDivBuf, 0.0);
   ArrayInitialize(BearHiddenDivBuf, 0.0);
}

//+------------------------------------------------------------------+
int OnInit()
{
   SetIndexBuffer(0, RSIPlotBuf,       INDICATOR_DATA);
   SetIndexBuffer(1, BullHiddenDivBuf, INDICATOR_CALCULATIONS);
   SetIndexBuffer(2, BearHiddenDivBuf, INDICATOR_CALCULATIONS);
   ArraySetAsSeries(RSIPlotBuf,       true);
   ArraySetAsSeries(BullHiddenDivBuf, true);
   ArraySetAsSeries(BearHiddenDivBuf, true);
   PlotIndexSetDouble(0, PLOT_EMPTY_VALUE, EMPTY_VALUE);

   IndicatorSetInteger(INDICATOR_LEVELS, 2);
   IndicatorSetDouble (INDICATOR_LEVELVALUE, 0, 30.0);
   IndicatorSetDouble (INDICATOR_LEVELVALUE, 1, 70.0);
   IndicatorSetInteger(INDICATOR_DIGITS, 2);

   gRSI = iRSI(_Symbol, InpTF, InpRSIPeriod, PRICE_CLOSE);
   if(gRSI == INVALID_HANDLE) { Print("RSI handle failed"); return INIT_FAILED; }
   IndicatorSetString(INDICATOR_SHORTNAME, "RSI HD (" + IntegerToString(InpRSIPeriod) + ")");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0, OBJ_PREFIX);
   if(gRSI != INVALID_HANDLE) IndicatorRelease(gRSI);
}

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   if(rates_total < InpPivotLeft + InpPivotRight + 5) return 0;
   if(BarsCalculated(gRSI) < rates_total) return prev_calculated;  // wait for RSI

   gWin = ChartWindowFind();

   // Fill the plotted RSI line.
   if(prev_calculated == 0)
   {
      if(CopyBuffer(gRSI, 0, 0, rates_total, RSIPlotBuf) <= 0) return 0;
   }
   else
   {
      RSIPlotBuf[0] = RSIv(0);
      RSIPlotBuf[1] = RSIv(1);
   }

   if(prev_calculated == 0)
   {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - InpPivotLeft - 2), (long)InpLookback);
      for(int sh = limit; sh >= 1; sh--) ProcessPivots(sh);
      return rates_total;
   }

   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime) { lastBarTime = curBar; ProcessPivots(1); }
   return rates_total;
}
`;
}
