/**
 * SMC Module Library — Phase 1: CHoCH Detector
 *
 * CHoCH_Detector v3.0.0
 * ────────────────────────────────────────────
 * Change of Character: price closes beyond a previous swing
 * AGAINST the current trend direction (reversal signal).
 *
 * Single-swing tracking model — aligned with Pine Script reference:
 *   ONE swing high and ONE swing low tracked at a time.
 *   A new confirmed pivot OVERWRITES the previous variable.
 *   After a break the variable is ZEROED (consumed).
 *
 * TREND STATE:
 *    0 = unknown  |  1 = bullish  |  -1 = bearish
 *
 * RULES:
 *   Close > swing high → if trend == -1 : BULLISH CHoCH → trend becomes 1
 *   Close < swing low  → if trend == +1 : BEARISH CHoCH → trend becomes -1
 *
 *   BOS events (when trend is already aligned) still update gTrend so the
 *   state machine stays accurate, but they are NOT drawn here —
 *   BOS_Detector handles those.
 *
 *   With trend == UNKNOWN, the first break is always treated as BOS
 *   (no CHoCH is drawn until a clear prior trend exists).
 *
 * DRAWN ELEMENTS:
 *   Dashed horizontal line from the broken swing to the break candle.
 *   Label "CHoCH" anchored at the break bar.
 *
 * JOURNAL:
 *   BULLISH_CHOCH | id | price | time | trend_before
 *   BEARISH_CHOCH | id | price | time | trend_before
 *
 * NO trading logic. Detection and visualisation only.
 */

export const CHOCH_DETECTOR_VERSION = "3.0.0";
export const CHOCH_DETECTOR_MODULE  = "CHoCH_Detector";

export function generateChochDetector(): string {
  return `//+------------------------------------------------------------------+
//| CHoCH_Detector.mq5                                              |
//| SMC Module Library v${CHOCH_DETECTOR_VERSION} — Phase 1: Detection Only       |
//|                                                                  |
//| Change of Character — close beyond a previous swing             |
//| AGAINST the current trend direction (reversal signal).          |
//|                                                                  |
//| Single-swing model (matches Pine Script):                       |
//|   One swing high + one swing low tracked at a time.             |
//|   New pivot overwrites previous; consumed (zeroed) on break.    |
//|                                                                  |
//| Trend: 0=unknown  1=bullish  -1=bearish                         |
//| Bullish CHoCH: close > swing high  AND trend == -1              |
//| Bearish CHoCH: close < swing low   AND trend == +1              |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "3.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

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
input int               InpSwingLeft   = 5;               // Swing strength: left bars
input int               InpSwingRight  = 5;               // Swing strength: right bars
input ENUM_CONFIRM_MODE InpConfirmMode = CONFIRM_CLOSE;   // Break confirmation

//--- Inputs — Colours
input color InpBullColor = clrDodgerBlue; // Bullish CHoCH colour
input color InpBearColor = clrOrange;     // Bearish CHoCH colour
input int   InpOpacity   = 85;            // Line opacity 0-100

//--- Inputs — Logging
input bool InpShowLog = true; // Print CHoCH events to journal

#define CHOCH_MAX 200

struct ChochRecord
{
   int      id;
   int      dir;        // +1 bullish, -1 bearish
   double   level;      // swing price that was broken
   datetime swingTime;  // left edge of the line
   datetime breakTime;  // right edge of the line (break bar)
   bool     drawn;
};

ChochRecord chochList[CHOCH_MAX];
int      chochTotal  = 0;
int      nextChochId = 0;
int      gTrend      = TREND_UNKNOWN;
datetime lastBarTime = 0;

// ── Single-swing tracking variables (Pine Script model) ───────────
double   gSwingHighPrice = 0.0;
datetime gSwingHighTime  = 0;
double   gSwingLowPrice  = 0.0;
datetime gSwingLowTime   = 0;

//+------------------------------------------------------------------+
string TrendName(int t)
{ return t == TREND_BULL ? "BULL" : t == TREND_BEAR ? "BEAR" : "UNKNOWN"; }

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
//| Scan bar sh as a pivot candidate.                               |
//| If confirmed, OVERWRITE the single swing variable (no list).    |
//| Pine Script equivalent: swingHighPrice := high[length]          |
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

   if(isHigh) { gSwingHighPrice = hi; gSwingHighTime = t; }
   if(isLow)  { gSwingLowPrice  = lo; gSwingLowTime  = t; }
}

//+------------------------------------------------------------------+
//| Check bar sh for a structure break.                             |
//|                                                                  |
//| CHoCH — break COUNTER to trend. gTrend is updated on all breaks.|
//| BOS  — break aligned with trend; trend updated, NOT drawn here. |
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
   if(gSwingHighPrice > 0.0 && gSwingHighTime > 0 && gSwingHighTime < barT
      && breakUp > gSwingHighPrice)
   {
      bool isChoch = (gTrend == TREND_BEAR); // CHoCH only when trend was bearish
      int  tBefore = gTrend;
      double   lvl  = gSwingHighPrice;
      datetime swgT = gSwingHighTime;

      gTrend          = TREND_BULL;
      gSwingHighPrice = 0.0;   // consume — Pine Script: swingHighPrice := na
      gSwingHighTime  = 0;

      if(isChoch && chochTotal < CHOCH_MAX)
      {
         int i = chochTotal++;
         chochList[i].id        = nextChochId++;
         chochList[i].dir       = +1;
         chochList[i].level     = lvl;
         chochList[i].swingTime = swgT;
         chochList[i].breakTime = barT;
         chochList[i].drawn     = false;

         if(InpShowLog)
            PrintFormat("BULLISH_CHOCH | id=%d | price=%.5f | time=%s | trend_before=%s",
               chochList[i].id, lvl,
               TimeToString(barT, TIME_DATE|TIME_MINUTES), TrendName(tBefore));
      }
      // !isChoch → BOS; trend still updated, BOS_Detector draws it
   }

   // ── Bearish break ─────────────────────────────────────────────────
   if(gSwingLowPrice > 0.0 && gSwingLowTime > 0 && gSwingLowTime < barT
      && breakDn < gSwingLowPrice)
   {
      bool isChoch = (gTrend == TREND_BULL); // CHoCH only when trend was bullish
      int  tBefore = gTrend;
      double   lvl  = gSwingLowPrice;
      datetime swgT = gSwingLowTime;

      gTrend         = TREND_BEAR;
      gSwingLowPrice = 0.0;    // consume
      gSwingLowTime  = 0;

      if(isChoch && chochTotal < CHOCH_MAX)
      {
         int i = chochTotal++;
         chochList[i].id        = nextChochId++;
         chochList[i].dir       = -1;
         chochList[i].level     = lvl;
         chochList[i].swingTime = swgT;
         chochList[i].breakTime = barT;
         chochList[i].drawn     = false;

         if(InpShowLog)
            PrintFormat("BEARISH_CHOCH | id=%d | price=%.5f | time=%s | trend_before=%s",
               chochList[i].id, lvl,
               TimeToString(barT, TIME_DATE|TIME_MINUTES), TrendName(tBefore));
      }
   }
}

//+------------------------------------------------------------------+
//| Draw one CHoCH event: dashed horizontal line + label.           |
//+------------------------------------------------------------------+
void CHOCH_DrawLine(int idx)
{
   color rawClr = (chochList[idx].dir > 0) ? InpBullColor : InpBearColor;
   color clr    = BlendWithBg(rawClr, InpOpacity);

   string pfx     = "SMCCHOCH_" + IntegerToString(chochList[idx].id);
   string objLine = pfx + "_line";
   string objLbl  = pfx + "_lbl";

   if(ObjectCreate(0, objLine, OBJ_TREND, 0,
                   chochList[idx].swingTime, chochList[idx].level,
                   chochList[idx].breakTime, chochList[idx].level))
   {
      ObjectSetInteger(0, objLine, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, objLine, OBJPROP_STYLE,      STYLE_DASH);
      ObjectSetInteger(0, objLine, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, objLine, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, objLine, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLine, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, objLine, OBJPROP_BACK,       true);
   }

   if(ObjectCreate(0, objLbl, OBJ_TEXT, 0,
                   chochList[idx].breakTime, chochList[idx].level))
   {
      ObjectSetString( 0, objLbl, OBJPROP_TEXT,     "CHoCH");
      ObjectSetInteger(0, objLbl, OBJPROP_COLOR,    clr);
      ObjectSetInteger(0, objLbl, OBJPROP_FONTSIZE, 7);
      ObjectSetInteger(0, objLbl, OBJPROP_ANCHOR,
         chochList[idx].dir > 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, objLbl, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLbl, OBJPROP_HIDDEN,    true);
      ObjectSetInteger(0, objLbl, OBJPROP_BACK,      false);
   }

   chochList[idx].drawn = true;
}

//+------------------------------------------------------------------+
void CHOCH_DrawNew()
{
   for(int i = 0; i < chochTotal; i++)
   {
      if(chochList[i].drawn) continue;
      CHOCH_DrawLine(i);
   }
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
void DeleteAll()
{
   for(int i = ObjectsTotal(0) - 1; i >= 0; i--)
   {
      string nm = ObjectName(0, i);
      if(StringFind(nm, "SMCCHOCH_") == 0) ObjectDelete(0, nm);
   }
}

//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAll();
   chochTotal = 0; nextChochId = 0;
   gTrend     = TREND_UNKNOWN;
   gSwingHighPrice = 0.0; gSwingHighTime = 0;
   gSwingLowPrice  = 0.0; gSwingLowTime  = 0;

   int avail = iBars(_Symbol, InpTF);
   if(avail < InpSwingLeft + InpSwingRight + 2)
   { Print("CHoCH_Detector: not enough bars."); return INIT_FAILED; }

   // Ensure oldest pivot candidate still has InpSwingLeft older bars
   int limit = MathMin(InpLookback, avail - InpSwingLeft - InpSwingRight - 2);

   // ── Interleaved chronological scan (high shift = old → low shift = new) ─
   //
   // At bar position sh, the pivot at (sh + InpSwingRight) has just had its
   // InpSwingRight-th right bar form — identical to Pine Script's
   //   ta.pivothigh(InpSwingLeft, InpSwingRight)  with InpSwingRight-bar lag.
   //
   // Order: overwrite swing variable FIRST, then check break at sh.
   for(int sh = limit; sh >= 1; sh--)
   {
      SWING_ScanBar(sh + InpSwingRight);
      CheckStructureBreak(sh);
   }

   CHOCH_DrawNew();

   int nBull=0, nBear=0;
   for(int i=0; i<chochTotal; i++) chochList[i].dir>0 ? nBull++ : nBear++;
   PrintFormat("CHoCH_Detector v3 ready | CHoCH bull=%d bear=%d | trend=%s | %s %s",
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

   // Bar 1 just closed → confirm pivot that now has InpSwingRight right bars
   SWING_ScanBar(InpSwingRight + 1);
   CheckStructureBreak(1);
   CHOCH_DrawNew();

   return rates_total;
}
`;
}
