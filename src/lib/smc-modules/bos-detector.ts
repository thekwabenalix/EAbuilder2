/**
 * SMC Module Library — Phase 1: BOS Detector
 *
 * BOS_Detector v1.0.0
 * ────────────────────────────────
 * Break of Structure — price closes beyond a previous swing in the
 * SAME direction as the current trend.
 *
 * TREND STATE:
 *    0 = unknown  |  1 = bullish  |  -1 = bearish
 *
 * RULES:
 *   Close > last swing high → if trend != -1 : BULLISH BOS  (trend stays/becomes 1)
 *   Close < last swing low  → if trend != +1 : BEARISH BOS  (trend stays/becomes -1)
 *
 *   In both cases the trend state is updated after the classification.
 *   CHoCH events (when trend DOES flip) are detected but not drawn here;
 *   they are handled by CHoCH_Detector.mq5.
 *
 * DRAWN ELEMENTS:
 *   Solid horizontal line from the broken swing to the break candle.
 *   Label "BOS" anchored at the break bar.
 *
 * JOURNAL:
 *   BULLISH_BOS | id | price | time | trend_before
 *   BEARISH_BOS | id | price | time | trend_before
 *
 * NO trading logic. Detection and visualisation only.
 */

export const BOS_DETECTOR_VERSION = "1.0.0";
export const BOS_DETECTOR_MODULE  = "BOS_Detector";

export function generateBosDetector(): string {
  return `//+------------------------------------------------------------------+
//| BOS_Detector.mq5                                                |
//| SMC Module Library v${BOS_DETECTOR_VERSION} — Phase 1: Detection Only       |
//|                                                                  |
//| Break of Structure: price closes beyond a previous swing in     |
//| the same direction as the current trend.                        |
//|                                                                  |
//| Trend: 0=unknown  1=bullish  -1=bearish                         |
//| Bullish BOS: close > last swing high  AND trend != -1           |
//| Bearish BOS: close < last swing low   AND trend != +1           |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

#define SWING_HIGH     1
#define SWING_LOW     -1
#define TREND_UNKNOWN  0
#define TREND_BULL     1
#define TREND_BEAR    -1

enum ENUM_CONFIRM_MODE
{
   CONFIRM_CLOSE = 0, // Candle close beyond level
   CONFIRM_WICK  = 1  // Wick breach of level
};

//--- Inputs — Detection
input ENUM_TIMEFRAMES   InpTF          = PERIOD_CURRENT; // Timeframe
input int               InpLookback    = 500;             // Historical bars to scan on load
input int               InpSwingLeft   = 3;               // Swing strength: left bars
input int               InpSwingRight  = 3;               // Swing strength: right bars
input ENUM_CONFIRM_MODE InpConfirmMode = CONFIRM_CLOSE;  // Break confirmation

//--- Inputs — Colours
input color InpBullColor = clrLimeGreen; // Bullish BOS colour
input color InpBearColor = clrCrimson;   // Bearish BOS colour
input int   InpOpacity   = 85;           // Line opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true; // Print BOS events to journal

#define SWING_MAX 600
#define BOS_MAX   200

struct SwingRecord
{
   int      id;
   int      type;   // SWING_HIGH or SWING_LOW
   double   price;
   datetime time;
   bool     broken;
};

struct BosRecord
{
   int      id;
   int      dir;        // +1 bullish, -1 bearish
   double   level;      // the swing price that was broken
   datetime swingTime;  // left edge of the line
   datetime breakTime;  // right edge of the line (break bar)
   bool     drawn;
};

SwingRecord swingList[SWING_MAX];
BosRecord   bosList  [BOS_MAX];
int      swingTotal  = 0;
int      bosTotal    = 0;
int      nextSwingId = 0;
int      nextBosId   = 0;
int      gTrend      = TREND_UNKNOWN;
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

string TrendName(int t)
{ return t == TREND_BULL ? "BULL" : t == TREND_BEAR ? "BEAR" : "UNKNOWN"; }

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
         swingList[idx].id     = nextSwingId++;
         swingList[idx].type   = SWING_HIGH;
         swingList[idx].price  = hi;
         swingList[idx].time   = t;
         swingList[idx].broken = false;
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
         swingList[idx].id     = nextSwingId++;
         swingList[idx].type   = SWING_LOW;
         swingList[idx].price  = lo;
         swingList[idx].time   = t;
         swingList[idx].broken = false;
      }
   }
}

//+------------------------------------------------------------------+
int FindProtectedHigh()
{
   int best=-1; datetime bestT=0;
   for(int i=0; i<swingTotal; i++)
   {
      if(swingList[i].type!=SWING_HIGH || swingList[i].broken) continue;
      if(swingList[i].time>bestT) { bestT=swingList[i].time; best=i; }
   }
   return best;
}

int FindProtectedLow()
{
   int best=-1; datetime bestT=0;
   for(int i=0; i<swingTotal; i++)
   {
      if(swingList[i].type!=SWING_LOW || swingList[i].broken) continue;
      if(swingList[i].time>bestT) { bestT=swingList[i].time; best=i; }
   }
   return best;
}

//+------------------------------------------------------------------+
//| Check bar sh for a structure break.                             |
//|                                                                  |
//| Both BOS and CHoCH events update gTrend.                        |
//| Only BOS events are recorded in bosList for drawing.            |
//+------------------------------------------------------------------+
void CheckStructureBreak(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   double breakUp = (InpConfirmMode == CONFIRM_WICK) ? barHigh : barClose;
   double breakDn = (InpConfirmMode == CONFIRM_WICK) ? barLow  : barClose;

   // ── Bullish break ─────────────────────────────────────────────────
   int hiIdx = FindProtectedHigh();
   if(hiIdx >= 0 && swingList[hiIdx].time < barT && breakUp > swingList[hiIdx].price)
   {
      bool isBos = (gTrend != TREND_BEAR); // BOS when trend was BULL or UNKNOWN
      int  tBefore = gTrend;
      swingList[hiIdx].broken = true;
      gTrend = TREND_BULL;

      if(isBos && bosTotal < BOS_MAX)
      {
         int i = bosTotal++;
         bosList[i].id        = nextBosId++;
         bosList[i].dir       = +1;
         bosList[i].level     = swingList[hiIdx].price;
         bosList[i].swingTime = swingList[hiIdx].time;
         bosList[i].breakTime = barT;
         bosList[i].drawn     = false;

         if(InpShowLog)
            PrintFormat("BULLISH_BOS | id=%d | price=%.5f | time=%s | trend_before=%s",
               bosList[i].id, bosList[i].level,
               TimeToString(barT, TIME_DATE|TIME_MINUTES), TrendName(tBefore));
      }
      // If !isBos this is a CHoCH — gTrend is still updated but BOS_Detector does not draw it.
   }

   // ── Bearish break ─────────────────────────────────────────────────
   int loIdx = FindProtectedLow();
   if(loIdx >= 0 && swingList[loIdx].time < barT && breakDn < swingList[loIdx].price)
   {
      bool isBos = (gTrend != TREND_BULL); // BOS when trend was BEAR or UNKNOWN
      int  tBefore = gTrend;
      swingList[loIdx].broken = true;
      gTrend = TREND_BEAR;

      if(isBos && bosTotal < BOS_MAX)
      {
         int i = bosTotal++;
         bosList[i].id        = nextBosId++;
         bosList[i].dir       = -1;
         bosList[i].level     = swingList[loIdx].price;
         bosList[i].swingTime = swingList[loIdx].time;
         bosList[i].breakTime = barT;
         bosList[i].drawn     = false;

         if(InpShowLog)
            PrintFormat("BEARISH_BOS | id=%d | price=%.5f | time=%s | trend_before=%s",
               bosList[i].id, bosList[i].level,
               TimeToString(barT, TIME_DATE|TIME_MINUTES), TrendName(tBefore));
      }
   }
}

//+------------------------------------------------------------------+
//| Draw one BOS event: solid horizontal line + "BOS" label.        |
//+------------------------------------------------------------------+
void BOS_DrawLine(int idx)
{
   color rawClr = (bosList[idx].dir > 0) ? InpBullColor : InpBearColor;
   color clr    = BlendWithBg(rawClr, InpOpacity);

   string pfx     = "SMCBOS_" + IntegerToString(bosList[idx].id);
   string objLine = pfx + "_line";
   string objLbl  = pfx + "_lbl";

   if(ObjectCreate(0, objLine, OBJ_TREND, 0,
                   bosList[idx].swingTime, bosList[idx].level,
                   bosList[idx].breakTime, bosList[idx].level))
   {
      ObjectSetInteger(0, objLine, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, objLine, OBJPROP_STYLE,      STYLE_SOLID);
      ObjectSetInteger(0, objLine, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, objLine, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, objLine, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLine, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, objLine, OBJPROP_BACK,       true);
   }

   if(ObjectCreate(0, objLbl, OBJ_TEXT, 0, bosList[idx].breakTime, bosList[idx].level))
   {
      ObjectSetString( 0, objLbl, OBJPROP_TEXT,     "BOS");
      ObjectSetInteger(0, objLbl, OBJPROP_COLOR,    clr);
      ObjectSetInteger(0, objLbl, OBJPROP_FONTSIZE, 7);
      ObjectSetInteger(0, objLbl, OBJPROP_ANCHOR,
         bosList[idx].dir > 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, objLbl, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLbl, OBJPROP_HIDDEN,   true);
      ObjectSetInteger(0, objLbl, OBJPROP_BACK,     false);
   }

   bosList[idx].drawn = true;
}

//+------------------------------------------------------------------+
void BOS_DrawNew()
{
   for(int i = 0; i < bosTotal; i++)
   {
      if(bosList[i].drawn) continue;
      BOS_DrawLine(i);
   }
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void DeleteAll()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCBOS_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAll();
   swingTotal=0; bosTotal=0; nextSwingId=0; nextBosId=0;
   gTrend = TREND_UNKNOWN;

   int avail = iBars(_Symbol, InpTF);
   if(avail < InpSwingLeft + InpSwingRight + 2)
   { Print("BOS_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - InpSwingLeft - 2);

   for(int sh = limit; sh >= InpSwingRight + 1; sh--)
      SWING_ScanBar(sh);

   for(int sh = limit; sh >= 1; sh--)
      CheckStructureBreak(sh);

   BOS_DrawNew();

   int nBull=0, nBear=0;
   for(int i=0; i<bosTotal; i++)
      bosList[i].dir>0 ? nBull++ : nBear++;

   PrintFormat("BOS_Detector v1 ready | BOS bull=%d bear=%d | trend=%s | %s %s",
               nBull, nBear, TrendName(gTrend), _Symbol, EnumToString(InpTF));
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
   CheckStructureBreak(1);
   BOS_DrawNew();

   return rates_total;
}
`;
}
