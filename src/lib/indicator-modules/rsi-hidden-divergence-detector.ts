/**
 * Indicator Module — RSI Hidden Divergence Detector (Phase 1) v1.0.0
 *
 * Hidden divergence is a TREND CONTINUATION setup. It does not decide
 * direction — it assumes a trend exists and flags continuation pullbacks.
 * Role in the 4-brain model: SETUP only.
 *
 * Bullish HD (uptrend pullback ending):
 *   Price  Swing Low 2 > Swing Low 1   (Higher Low)
 *   RSI    Swing Low 2 < Swing Low 1   (Lower Low)
 *
 * Bearish HD (downtrend pullback ending):
 *   Price  Swing High 2 < Swing High 1 (Lower High)
 *   RSI    Swing High 2 > Swing High 1 (Higher High)
 *
 * Compared on consecutive confirmed price pivots; RSI read at the pivot bar.
 *
 * Buffers (iCustom):
 *   0 : BullHiddenDivBuf — 1.0 at the bar of the second (newer) swing low
 *   1 : BearHiddenDivBuf — 1.0 at the bar of the second (newer) swing high
 *
 * Visuals: green line connecting the two price lows (bull) / red line
 *   connecting the two price highs (bear), plus a "Bull HD" / "Bear HD" label.
 */

export const RSI_HD_DETECTOR_VERSION = "1.0.0";
export const RSI_HD_DETECTOR_MODULE  = "RSI_Hidden_Divergence_Detector";

export function generateRsiHiddenDivergenceDetector(): string {
  return `//+------------------------------------------------------------------+
//| RSI_Hidden_Divergence_Detector.mq5                            |
//| Indicator Module v${RSI_HD_DETECTOR_VERSION} — RSI Hidden Divergence (Setup)|
//|                                                                  |
//| Trend-continuation setup. Bullish HD: price HL + RSI LL.        |
//| Bearish HD: price LH + RSI HH. Detection + visualisation only.  |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Indicator Module"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_buffers 2
#property indicator_plots   0

double BullHiddenDivBuf[];
double BearHiddenDivBuf[];

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
datetime lastBarTime = 0;

// Rolling last confirmed swing low / high (price + RSI + time)
bool     gHasLow  = false; double gLowPrice  = 0, gLowRSI  = 0; datetime gLowTime  = 0;
bool     gHasHigh = false; double gHighPrice = 0, gHighRSI = 0; datetime gHighTime = 0;
int      gObjCnt = 0;

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
void DrawDivLine(int dir, datetime t1, double p1, datetime t2, double p2)
{
   string ln  = OBJ_PREFIX + IntegerToString(gObjCnt) + "_ln";
   string lbl = OBJ_PREFIX + IntegerToString(gObjCnt) + "_lb";
   gObjCnt++;
   color c = (dir > 0) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, ln, OBJ_TREND, 0, t1, p1, t2, p2))
   {
      ObjectSetInteger(0, ln, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, ln, OBJPROP_WIDTH,      InpLineWidth);
      ObjectSetInteger(0, ln, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, ln, OBJPROP_SELECTABLE, false);
   }
   if(ObjectCreate(0, lbl, OBJ_TEXT, 0, t2, p2))
   {
      ObjectSetString (0, lbl, OBJPROP_TEXT,       dir > 0 ? "Bull HD" : "Bear HD");
      ObjectSetInteger(0, lbl, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, lbl, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, lbl, OBJPROP_ANCHOR,     dir > 0 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, lbl, OBJPROP_SELECTABLE, false);
   }
}

//+------------------------------------------------------------------+
// Evaluate the pivot candidate that just became confirmable for bar sh.
void ProcessPivots(int sh)
{
   int p = sh + InpPivotRight;          // candidate has InpPivotRight newer bars now
   int bufN = ArraySize(BullHiddenDivBuf);

   // ── Swing low → Bullish HD ────────────────────────────────────
   if(IsPivotLow(p))
   {
      double price = iLow(_Symbol, InpTF, p);
      double rsi   = RSIv(p);
      datetime tp  = iTime(_Symbol, InpTF, p);
      if(gHasLow && rsi != EMPTY_VALUE)
      {
         int s1   = iBarShift(_Symbol, InpTF, gLowTime);
         int gap  = s1 - p;
         if(gap >= InpMinBars && gap <= InpMaxBars)
         {
            // Higher Low in price, Lower Low in RSI
            if(price > gLowPrice && rsi < gLowRSI)
            {
               if(p < bufN) BullHiddenDivBuf[p] = 1.0;
               DrawDivLine(1, gLowTime, gLowPrice, tp, price);
               if(InpShowLog)
                  PrintFormat("RSI_HD_BULL | pL1=%.5f pL2=%.5f | rL1=%.2f rL2=%.2f | %s",
                     gLowPrice, price, gLowRSI, rsi, TimeToString(tp, TIME_DATE|TIME_MINUTES));
            }
         }
      }
      if(rsi != EMPTY_VALUE)
         { gLowPrice = price; gLowRSI = rsi; gLowTime = tp; gHasLow = true; }
   }

   // ── Swing high → Bearish HD ───────────────────────────────────
   if(IsPivotHigh(p))
   {
      double price = iHigh(_Symbol, InpTF, p);
      double rsi   = RSIv(p);
      datetime tp  = iTime(_Symbol, InpTF, p);
      if(gHasHigh && rsi != EMPTY_VALUE)
      {
         int s1   = iBarShift(_Symbol, InpTF, gHighTime);
         int gap  = s1 - p;
         if(gap >= InpMinBars && gap <= InpMaxBars)
         {
            // Lower High in price, Higher High in RSI
            if(price < gHighPrice && rsi > gHighRSI)
            {
               if(p < bufN) BearHiddenDivBuf[p] = 1.0;
               DrawDivLine(-1, gHighTime, gHighPrice, tp, price);
               if(InpShowLog)
                  PrintFormat("RSI_HD_BEAR | pH1=%.5f pH2=%.5f | rH1=%.2f rH2=%.2f | %s",
                     gHighPrice, price, gHighRSI, rsi, TimeToString(tp, TIME_DATE|TIME_MINUTES));
            }
         }
      }
      if(rsi != EMPTY_VALUE)
         { gHighPrice = price; gHighRSI = rsi; gHighTime = tp; gHasHigh = true; }
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
   SetIndexBuffer(0, BullHiddenDivBuf, INDICATOR_DATA);
   SetIndexBuffer(1, BearHiddenDivBuf, INDICATOR_DATA);
   ArraySetAsSeries(BullHiddenDivBuf, true);
   ArraySetAsSeries(BearHiddenDivBuf, true);
   gRSI = iRSI(_Symbol, InpTF, InpRSIPeriod, PRICE_CLOSE);
   if(gRSI == INVALID_HANDLE) { Print("RSI handle failed"); return INIT_FAILED; }
   IndicatorSetString(INDICATOR_SHORTNAME, "RSI_HD v${RSI_HD_DETECTOR_VERSION}");
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

   if(prev_calculated == 0)
   {
      ResetState();
      int limit = (int)MathMin((long)(rates_total - InpPivotLeft - 2), (long)InpLookback);
      // walk oldest → newest so swing chain builds in order
      for(int sh = limit; sh >= 1; sh--) ProcessPivots(sh);
      return rates_total;
   }

   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime) { lastBarTime = curBar; ProcessPivots(1); }
   return rates_total;
}
`;
}
