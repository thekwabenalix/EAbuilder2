/**
 * SMC Module Library — Phase 1: Swing Structure Detector
 *
 * Swing_Structure_Detector v1.0.0
 * ────────────────────────────────
 * Detects and visualises confirmed pivot highs and pivot lows only.
 * No BOS. No CHoCH. No trend classification.
 *
 * SWING HIGH:  candle high > N left bars AND M right bars.
 * SWING LOW:   candle low  < N left bars AND M right bars.
 *
 * A swing at shift s is confirmed when M right-side bars have closed,
 * so there is a built-in M-bar lag.
 *
 * JOURNAL:
 *   SWING_HIGH_FORMED | id | price | time
 *   SWING_LOW_FORMED  | id | price | time
 *
 * DRAWN ELEMENTS:
 *   ▼ OBJ_ARROW (code 234) at each swing high price
 *   ▲ OBJ_ARROW (code 233) at each swing low price
 *
 * NO trading logic. Detection and visualisation only.
 */

export const SWING_STRUCTURE_DETECTOR_VERSION = "1.0.0";
export const SWING_STRUCTURE_DETECTOR_MODULE = "Swing_Structure_Detector";

export function generateSwingStructureDetector(): string {
  return `//+------------------------------------------------------------------+
//| Swing_Structure_Detector.mq5                                    |
//| SMC Module Library v${SWING_STRUCTURE_DETECTOR_VERSION} — Phase 1: Detection Only  |
//|                                                                  |
//| Detects confirmed pivot highs and pivot lows.                   |
//| No BOS. No CHoCH. No trend classification.                      |
//|                                                                  |
//| Swing High: high > N left bars AND M right bars                 |
//| Swing Low:  low  < N left bars AND M right bars                 |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define SWING_HIGH  1
#define SWING_LOW  -1

//--- Inputs — Detection
input ENUM_TIMEFRAMES InpTF         = PERIOD_CURRENT; // Timeframe
input int             InpLookback   = 500;             // Historical bars to scan on load
input int             InpSwingLeft  = 3;               // Swing strength: left bars
input int             InpSwingRight = 3;               // Swing strength: right bars

//--- Inputs — Visibility
input bool InpShowHighs = true; // Show swing high markers
input bool InpShowLows  = true; // Show swing low markers

//--- Inputs — Colours
input color InpHighClr = clrSilver; // Swing high marker colour
input color InpLowClr  = clrSilver; // Swing low marker colour
input int   InpOpacity = 70;        // Marker opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true; // Print swing events to journal

#define SWING_MAX 800

struct SwingRecord
{
   int      id;
   int      type;   // SWING_HIGH or SWING_LOW
   double   price;
   datetime time;
   bool     drawn;
};

SwingRecord swingList[SWING_MAX];
int      swingTotal  = 0;
int      nextSwingId = 0;
datetime lastBarTime = 0;

//+------------------------------------------------------------------+
color BlendWithBg(color base, int opacityPct)
{
   color  bg = (color)ChartGetInteger(0, CHART_COLOR_BACKGROUND);
   double t  = MathMax(0.0, MathMin(100.0, (double)opacityPct)) / 100.0;
   int baseR = (int)( base & 0xFF);        int bgR = (int)( bg & 0xFF);
   int baseG = (int)((base >>  8) & 0xFF); int bgG = (int)((bg >>  8) & 0xFF);
   int baseB = (int)((base >> 16) & 0xFF); int bgB = (int)((bg >> 16) & 0xFF);
   int r = (int)(baseR * t + bgR * (1.0 - t));
   int g = (int)(baseG * t + bgG * (1.0 - t));
   int b = (int)(baseB * t + bgB * (1.0 - t));
   return (color)(r | (g << 8) | (b << 16));
}

//+------------------------------------------------------------------+
//| Scan bar sh as a candidate swing high / swing low.              |
//+------------------------------------------------------------------+
void SWING_ScanBar(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh < InpSwingRight + 1 || sh + InpSwingLeft >= avail) return;

   double   hi = iHigh(_Symbol, InpTF, sh);
   double   lo = iLow (_Symbol, InpTF, sh);
   datetime t  = iTime(_Symbol, InpTF, sh);

   bool isHigh = true, isLow = true;
   int  maxK   = MathMax(InpSwingLeft, InpSwingRight);
   for(int k = 1; k <= maxK && (isHigh || isLow); k++)
   {
      if(k <= InpSwingLeft)
      {
         if(iHigh(_Symbol, InpTF, sh + k) >= hi) isHigh = false;
         if(iLow (_Symbol, InpTF, sh + k) <= lo) isLow  = false;
      }
      if(k <= InpSwingRight)
      {
         if(iHigh(_Symbol, InpTF, sh - k) >= hi) isHigh = false;
         if(iLow (_Symbol, InpTF, sh - k) <= lo) isLow  = false;
      }
   }

   if(isHigh && swingTotal < SWING_MAX)
   {
      bool dup = false;
      for(int i = 0; i < swingTotal; i++)
         if(swingList[i].type == SWING_HIGH && swingList[i].time == t) { dup=true; break; }
      if(!dup)
      {
         int idx = swingTotal++;
         swingList[idx].id    = nextSwingId++;
         swingList[idx].type  = SWING_HIGH;
         swingList[idx].price = hi;
         swingList[idx].time  = t;
         swingList[idx].drawn = false;
         if(InpShowLog)
            PrintFormat("SWING_HIGH_FORMED | id=%d | price=%.5f | time=%s",
               swingList[idx].id, hi, TimeToString(t, TIME_DATE|TIME_MINUTES));
      }
   }

   if(isLow && swingTotal < SWING_MAX)
   {
      bool dup = false;
      for(int i = 0; i < swingTotal; i++)
         if(swingList[i].type == SWING_LOW && swingList[i].time == t) { dup=true; break; }
      if(!dup)
      {
         int idx = swingTotal++;
         swingList[idx].id    = nextSwingId++;
         swingList[idx].type  = SWING_LOW;
         swingList[idx].price = lo;
         swingList[idx].time  = t;
         swingList[idx].drawn = false;
         if(InpShowLog)
            PrintFormat("SWING_LOW_FORMED | id=%d | price=%.5f | time=%s",
               swingList[idx].id, lo, TimeToString(t, TIME_DATE|TIME_MINUTES));
      }
   }
}

//+------------------------------------------------------------------+
//| Draw one swing marker.                                           |
//|   Swing high → ▼ (code 234) at the high price                  |
//|   Swing low  → ▲ (code 233) at the low price                   |
//+------------------------------------------------------------------+
void SWING_DrawMarker(int idx)
{
   bool isHigh = (swingList[idx].type == SWING_HIGH);
   if(isHigh && !InpShowHighs) return;
   if(!isHigh && !InpShowLows)  return;

   color clr  = BlendWithBg(isHigh ? InpHighClr : InpLowClr, InpOpacity);
   string nm  = "SMCSW_" + IntegerToString(swingList[idx].id) +
                (isHigh ? "_h" : "_l");

   if(ObjectCreate(0, nm, OBJ_ARROW, 0, swingList[idx].time, swingList[idx].price))
   {
      ObjectSetInteger(0, nm, OBJPROP_ARROWCODE,  isHigh ? 234 : 233);
      ObjectSetInteger(0, nm, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, nm, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, nm, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, nm, OBJPROP_BACK,       true);
   }
}

//+------------------------------------------------------------------+
//| Draw all undrawn swing markers.                                  |
//+------------------------------------------------------------------+
void SWING_DrawNew()
{
   for(int i = 0; i < swingTotal; i++)
   {
      if(swingList[i].drawn) continue;
      SWING_DrawMarker(i);
      swingList[i].drawn = true;
   }
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void DeleteAll()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCSW_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAll();
   swingTotal = 0; nextSwingId = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < InpSwingLeft + InpSwingRight + 2)
   { Print("Swing_Structure_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - InpSwingLeft - 2);

   for(int sh = limit; sh >= InpSwingRight + 1; sh--)
      SWING_ScanBar(sh);

   SWING_DrawNew();

   int nH=0, nL=0;
   for(int i = 0; i < swingTotal; i++)
      swingList[i].type == SWING_HIGH ? nH++ : nL++;

   PrintFormat("Swing_Structure_Detector v1 ready | highs=%d lows=%d | %s %s",
               nH, nL, _Symbol, EnumToString(InpTF));
   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason) { DeleteAll(); ChartRedraw(0); }

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total, const int prev_calculated,
                const datetime &time[], const double &open[],
                const double &high[], const double &low[],
                const double &close[], const long &tick_volume[],
                const long &volume[], const int &spread[])
{
   datetime currentBar = iTime(_Symbol, InpTF, 0);
   if(currentBar == lastBarTime) return rates_total;
   lastBarTime = currentBar;

   SWING_ScanBar(InpSwingRight + 1);
   SWING_DrawNew();

   return rates_total;
}
`;
}
