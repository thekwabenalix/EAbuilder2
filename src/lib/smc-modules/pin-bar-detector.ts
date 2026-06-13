/**
 * Pin Bar Detector v1.0.0
 *
 * Bull pin: lower wick >= wickRatio of range AND body <= bodyMaxRatio of range.
 * Bear pin: upper wick >= wickRatio of range AND body <= bodyMaxRatio of range.
 */

export const PIN_BAR_DETECTOR_VERSION = "1.0.0";
export const PIN_BAR_DETECTOR_MODULE = "Pin_Bar_Detector";

export function generatePinBarDetector(): string {
  return `//+------------------------------------------------------------------+
//| Pin_Bar_Detector.mq5                                           |
//| Pin Bar Detector v${PIN_BAR_DETECTOR_VERSION}                              |
//| Long-wick rejection candle — hammer / shooting star.            |
//+------------------------------------------------------------------+
#property copyright "EA Builder — Candle Pattern"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define OBJ_PREFIX "SMCPIN_"

input ENUM_TIMEFRAMES InpTF           = PERIOD_CURRENT;
input double          InpWickRatio    = 0.6;   // Wick >= N × range
input double          InpBodyMaxRatio = 0.35;  // Body <= N × range
input bool            InpDraw          = true;
input string          InpLabel         = "Pin";
input int             InpFontSize      = 8;
input color           InpBullColor     = clrMediumSeaGreen;
input color           InpBearColor     = clrTomato;
input bool            InpShowLog       = true;

datetime lastBarTime = 0;

bool IsBullPin(int sh)
{
   double o = iOpen (_Symbol, InpTF, sh);
   double c = iClose(_Symbol, InpTF, sh);
   double h = iHigh (_Symbol, InpTF, sh);
   double l = iLow  (_Symbol, InpTF, sh);
   double rng = h - l;
   if(rng <= 0.0) return false;
   double body  = MathAbs(c - o);
   double lwick = MathMin(o, c) - l;
   return lwick >= rng * InpWickRatio && body <= rng * InpBodyMaxRatio;
}

bool IsBearPin(int sh)
{
   double o = iOpen (_Symbol, InpTF, sh);
   double c = iClose(_Symbol, InpTF, sh);
   double h = iHigh (_Symbol, InpTF, sh);
   double l = iLow  (_Symbol, InpTF, sh);
   double rng = h - l;
   if(rng <= 0.0) return false;
   double body  = MathAbs(c - o);
   double uwick = h - MathMax(o, c);
   return uwick >= rng * InpWickRatio && body <= rng * InpBodyMaxRatio;
}

void DrawPin(int sh, int dir)
{
   if(!InpDraw) return;
   datetime t = iTime(_Symbol, InpTF, sh);
   string nm = OBJ_PREFIX + IntegerToString((int)t) + (dir == 1 ? "_B" : "_S");
   double h = iHigh(_Symbol, InpTF, sh);
   double l = iLow (_Symbol, InpTF, sh);
   double anchor = (dir == 1) ? l : h;
   color c = (dir == 1) ? InpBullColor : InpBearColor;
   if(ObjectCreate(0, nm, OBJ_TEXT, 0, t, anchor))
   {
      ObjectSetString (0, nm, OBJPROP_TEXT,       InpLabel);
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      c);
      ObjectSetInteger(0, nm, OBJPROP_FONTSIZE,   InpFontSize);
      ObjectSetInteger(0, nm, OBJPROP_ANCHOR,     dir == 1 ? ANCHOR_UPPER : ANCHOR_LOWER);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
   }
}

void ScanBar(int sh)
{
   if(IsBullPin(sh))
   {
      DrawPin(sh, 1);
      if(InpShowLog && sh == 1)
         PrintFormat("PIN_BULL | SL=%.5f | %s", iLow(_Symbol, InpTF, sh),
            TimeToString(iTime(_Symbol, InpTF, sh), TIME_DATE|TIME_MINUTES));
   }
   if(IsBearPin(sh))
   {
      DrawPin(sh, -1);
      if(InpShowLog && sh == 1)
         PrintFormat("PIN_BEAR | SL=%.5f | %s", iHigh(_Symbol, InpTF, sh),
            TimeToString(iTime(_Symbol, InpTF, sh), TIME_DATE|TIME_MINUTES));
   }
}

int OnInit()  { lastBarTime = 0; return INIT_SUCCEEDED; }
void OnDeinit(const int reason) { ObjectsDeleteAll(0, OBJ_PREFIX); }

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
