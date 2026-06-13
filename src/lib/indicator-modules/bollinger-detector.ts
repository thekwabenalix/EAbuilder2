/**
 * Bollinger Bands Detector v1.0.0
 *
 * Touch: lower-band rejection (bull) / upper-band rejection (bear).
 * Breakout: close beyond upper (bull) / lower (bear).
 */

export const BOLL_DETECTOR_VERSION = "1.0.0";
export const BOLL_DETECTOR_MODULE = "Bollinger_Detector";

export function generateBollingerDetector(): string {
  return `//+------------------------------------------------------------------+
//| Bollinger_Detector.mq5                                         |
//| Bollinger Bands v${BOLL_DETECTOR_VERSION} — touch & breakout marks     |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Indicator"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define OBJ_PREFIX "SMCBOLL_"

input ENUM_TIMEFRAMES InpTF        = PERIOD_CURRENT;
input int             InpPeriod    = 20;
input double          InpDeviation = 2.0;
input bool            InpDraw      = true;
input bool            InpShowLog   = true;

int      hBands = INVALID_HANDLE;
datetime lastBarTime = 0;

double BandVal(int buf, int sh)
{
   double arr[1];
   if(hBands == INVALID_HANDLE) return 0.0;
   if(CopyBuffer(hBands, buf, sh, 1, arr) != 1) return 0.0;
   return arr[0];
}

void DrawMark(datetime t, double p, string txt, color c)
{
   if(!InpDraw) return;
   string nm = OBJ_PREFIX + IntegerToString((int)t) + txt;
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, p))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT,       txt);
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE,   8);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

void ScanBar(int sh)
{
   double mid = BandVal(0, sh);
   double up  = BandVal(1, sh);
   double lo  = BandVal(2, sh);
   if(mid <= 0.0 || up <= 0.0 || lo <= 0.0) return;
   double c = iClose(_Symbol, InpTF, sh);
   double h = iHigh (_Symbol, InpTF, sh);
   double l = iLow  (_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);
   if(l <= lo && c > lo)
   {
      DrawMark(t, lo, "BB+", clrMediumSeaGreen);
      if(InpShowLog && sh == 1) PrintFormat("BB_TOUCH_BULL | lo=%.5f | %s", lo, TimeToString(t, TIME_DATE|TIME_MINUTES));
   }
   if(h >= up && c < up)
   {
      DrawMark(t, up, "BB-", clrTomato);
      if(InpShowLog && sh == 1) PrintFormat("BB_TOUCH_BEAR | up=%.5f | %s", up, TimeToString(t, TIME_DATE|TIME_MINUTES));
   }
   if(c > up)
   {
      DrawMark(t, up, "BB^", clrDodgerBlue);
      if(InpShowLog && sh == 1) PrintFormat("BB_BREAKOUT_BULL | up=%.5f | %s", up, TimeToString(t, TIME_DATE|TIME_MINUTES));
   }
   if(c < lo)
   {
      DrawMark(t, lo, "BBv", clrOrangeRed);
      if(InpShowLog && sh == 1) PrintFormat("BB_BREAKOUT_BEAR | lo=%.5f | %s", lo, TimeToString(t, TIME_DATE|TIME_MINUTES));
   }
}

int OnInit()
{
   hBands = iBands(_Symbol, InpTF, InpPeriod, 0, InpDeviation, PRICE_CLOSE);
   if(hBands == INVALID_HANDLE) return INIT_FAILED;
   lastBarTime = 0;
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(hBands != INVALID_HANDLE) IndicatorRelease(hBands);
   ObjectsDeleteAll(0, OBJ_PREFIX);
}

int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime curBar = iTime(_Symbol, InpTF, 0);
   if(curBar != lastBarTime)
   {
      lastBarTime = curBar;
      ScanBar(1);
   }
   return rates_total;
}
`;
}
