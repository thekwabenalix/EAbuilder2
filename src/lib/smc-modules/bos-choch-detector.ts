/**
 * SMC Module Library — Phase 1: BOS / CHoCH Detector
 *
 * BOS_CHoCH_Detector v1.0.0
 * ────────────────────────────────
 * Identifies Break of Structure (BOS) and Change of Character (CHoCH)
 * events using swing-based market structure analysis.
 *
 * SWING DETECTION:
 *   Swing High: candle high > N left candles AND M right candles.
 *   Swing Low:  candle low  < N left candles AND M right candles.
 *   InpSwingLeft = N, InpSwingRight = M (defaults 3 / 3).
 *   A swing at shift s is confirmed when InpSwingRight bars to the right
 *   have closed — there is a built-in InpSwingRight-bar lag.
 *
 * STRUCTURE BIAS:
 *   BULL  — close above the most recent unbroken swing high.
 *   BEAR  — close below the most recent unbroken swing low.
 *   NEUTRAL — no break yet in the lookback window.
 *
 * BOS (Break of Structure — trend continuation):
 *   Bullish BOS : close > protected swing high   AND bias was BULL
 *   Bearish BOS : close < protected swing low    AND bias was BEAR
 *
 * CHoCH (Change of Character — potential reversal):
 *   Bullish CHoCH: close > protected swing high  AND bias was BEAR (or NEUTRAL)
 *   Bearish CHoCH: close < protected swing low   AND bias was BULL (or NEUTRAL)
 *
 * JOURNAL:
 *   SWING_HIGH_CREATED | id | price | time
 *   SWING_LOW_CREATED  | id | price | time
 *   BULLISH_BOS   | id | price | time | bias_before | bias_after
 *   BEARISH_BOS   | id | price | time | bias_before | bias_after
 *   BULLISH_CHOCH | id | price | time | bias_before | bias_after
 *   BEARISH_CHOCH | id | price | time | bias_before | bias_after
 *
 * DRAWN ELEMENTS:
 *   • Swing high/low markers (small arrows, toggleable)
 *   • Horizontal line from swing candle to break bar
 *       BOS   → STYLE_SOLID
 *       CHoCH → STYLE_DASH
 *   • Label "BOS" or "CHoCH" at the break bar
 *
 * NO trading logic. Detection and visualisation only.
 */

export const BOS_CHOCH_DETECTOR_VERSION = "1.0.0";
export const BOS_CHOCH_DETECTOR_MODULE = "BOS_CHoCH_Detector";

/**
 * Returns the complete MQL5 source code for the BOS/CHoCH Detector (v1.0).
 * Drop the output into MetaEditor, compile, and attach to any chart.
 */
export function generateBosChochDetector(): string {
  return `//+------------------------------------------------------------------+
//| BOS_CHoCH_Detector.mq5                                          |
//| SMC Module Library v${BOS_CHOCH_DETECTOR_VERSION} — Phase 1: Detection Only       |
//|                                                                  |
//| Break of Structure (BOS) and Change of Character (CHoCH)        |
//| detector using swing-based market structure analysis.           |
//|                                                                  |
//| BULLISH BOS  : close > protected swing high  (bias was BULL)    |
//| BEARISH BOS  : close < protected swing low   (bias was BEAR)    |
//| BULLISH CHoCH: close > protected swing high  (bias was BEAR)    |
//| BEARISH CHoCH: close < protected swing low   (bias was BULL)    |
//|                                                                  |
//| NO trading logic. Detection and visualisation only.             |
//+------------------------------------------------------------------+
#property copyright "EA Builder — SMC Module Library"
#property version   "1.00"
#property strict
#property indicator_chart_window
#property indicator_plots 0

//--- Structure type constants
#define SWING_HIGH    1
#define SWING_LOW    -1

#define BIAS_NEUTRAL  0
#define BIAS_BULL     1
#define BIAS_BEAR    -1

#define STR_BOS_BULL    1
#define STR_BOS_BEAR    2
#define STR_CHOCH_BULL  3
#define STR_CHOCH_BEAR  4

//--- Confirmation mode
enum ENUM_CONFIRM_MODE
{
   CONFIRM_CLOSE = 0, // Candle close beyond level
   CONFIRM_WICK  = 1  // Wick breach of level
};

//--- Inputs — Detection
input ENUM_TIMEFRAMES   InpTF          = PERIOD_CURRENT; // Timeframe to scan
input int               InpLookback    = 500;             // Historical bars to scan on load
input int               InpSwingLeft   = 3;               // Swing strength: left bars
input int               InpSwingRight  = 3;               // Swing strength: right bars
input ENUM_CONFIRM_MODE InpConfirmMode = CONFIRM_CLOSE;  // Structure break confirmation

//--- Inputs — Visibility
input bool InpShowBos    = true;  // Draw BOS markers
input bool InpShowChoch  = true;  // Draw CHoCH markers
input bool InpShowSwings = true;  // Draw swing high/low markers

//--- Inputs — Colours
input color InpBullBosClr   = clrLimeGreen;   // Bullish BOS colour
input color InpBearBosClr   = clrCrimson;     // Bearish BOS colour
input color InpBullChochClr = clrDodgerBlue;  // Bullish CHoCH colour
input color InpBearChochClr = clrOrange;      // Bearish CHoCH colour
input color InpSwingClr     = clrGray;        // Swing marker colour

//--- Inputs — Opacity
input int InpLineOpacity  = 85; // BOS/CHoCH line opacity  0–100
input int InpSwingOpacity = 50; // Swing marker opacity    0–100

//--- Inputs — Logging
input bool InpShowLog = true; // Print lifecycle events to journal

//--- Array capacities
#define SWING_MAX  800
#define STRUCT_MAX 400

//+------------------------------------------------------------------+
//| Swing Record: a confirmed price extreme                          |
//+------------------------------------------------------------------+
struct SwingRecord
{
   int      id;
   int      type;    // SWING_HIGH or SWING_LOW
   double   price;   // the extreme price
   datetime time;    // opening time of the swing candle
   bool     broken;  // true once a BOS/CHoCH has closed through this level
   bool     drawn;   // has the swing marker been rendered?
};

//+------------------------------------------------------------------+
//| Structure Record: one BOS or CHoCH event                        |
//+------------------------------------------------------------------+
struct StructureRecord
{
   int      id;
   int      stype;       // STR_BOS_BULL / STR_BOS_BEAR / STR_CHOCH_BULL / STR_CHOCH_BEAR
   int      dir;         // +1 bullish, -1 bearish
   double   level;       // the swing price that was broken
   datetime swingTime;   // time of the swing candle (left edge of the line)
   datetime breakTime;   // bar at which the break was confirmed
   int      biasBefore;  // structure bias before this break
   int      biasAfter;   // structure bias after this break
   bool     active;
   bool     drawn;       // has this event been rendered?
};

//--- Global state
SwingRecord     swingList[SWING_MAX];
StructureRecord strList  [STRUCT_MAX];
int      swingTotal   = 0;
int      strTotal     = 0;
int      nextSwingId  = 0;
int      nextStrId    = 0;
int      gBias        = BIAS_NEUTRAL; // current structure bias
datetime lastBarTime  = 0;

//+------------------------------------------------------------------+
//| Blend a colour toward the chart background (theme-aware opacity).|
//| opacityPct 100 = full colour, 0 = invisible.                    |
//| MQL5 colour layout: 0x00BBGGRR                                   |
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
//| Return human-readable bias label for logging.                   |
//+------------------------------------------------------------------+
string BiasName(int bias)
{
   if(bias == BIAS_BULL) return "BULL";
   if(bias == BIAS_BEAR) return "BEAR";
   return "NEUTRAL";
}

//+------------------------------------------------------------------+
//| Scan bar sh as a candidate swing high and/or swing low.         |
//|                                                                  |
//| Swing High at shift sh requires:                                |
//|   iHigh(sh) > iHigh(sh + k) for k = 1..InpSwingLeft  (older)   |
//|   iHigh(sh) > iHigh(sh - k) for k = 1..InpSwingRight (newer)   |
//| Symmetric rule for Swing Low.                                    |
//+------------------------------------------------------------------+
void SWING_ScanBar(int sh)
{
   int avail = iBars(_Symbol, InpTF);
   if(sh < InpSwingRight + 1 || sh + InpSwingLeft >= avail) return;

   double hi = iHigh(_Symbol, InpTF, sh);
   double lo = iLow (_Symbol, InpTF, sh);
   datetime t = iTime(_Symbol, InpTF, sh);

   bool isHigh = true, isLow = true;
   int maxK = MathMax(InpSwingLeft, InpSwingRight);
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

   // ── Swing High ────────────────────────────────────────────────────
   if(isHigh && swingTotal < SWING_MAX)
   {
      // Deduplication: skip if we already have a swing high at this time
      bool dup = false;
      for(int i = 0; i < swingTotal; i++)
         if(swingList[i].type == SWING_HIGH && swingList[i].time == t) { dup = true; break; }
      if(!dup)
      {
         int idx = swingTotal++;
         swingList[idx].id     = nextSwingId++;
         swingList[idx].type   = SWING_HIGH;
         swingList[idx].price  = hi;
         swingList[idx].time   = t;
         swingList[idx].broken = false;
         swingList[idx].drawn  = false;
         if(InpShowLog)
            PrintFormat("SWING_HIGH_CREATED | id=%d | price=%.5f | time=%s",
               swingList[idx].id, hi, TimeToString(t, TIME_DATE|TIME_MINUTES));
      }
   }

   // ── Swing Low ─────────────────────────────────────────────────────
   if(isLow && swingTotal < SWING_MAX)
   {
      bool dup = false;
      for(int i = 0; i < swingTotal; i++)
         if(swingList[i].type == SWING_LOW && swingList[i].time == t) { dup = true; break; }
      if(!dup)
      {
         int idx = swingTotal++;
         swingList[idx].id     = nextSwingId++;
         swingList[idx].type   = SWING_LOW;
         swingList[idx].price  = lo;
         swingList[idx].time   = t;
         swingList[idx].broken = false;
         swingList[idx].drawn  = false;
         if(InpShowLog)
            PrintFormat("SWING_LOW_CREATED | id=%d | price=%.5f | time=%s",
               swingList[idx].id, lo, TimeToString(t, TIME_DATE|TIME_MINUTES));
      }
   }
}

//+------------------------------------------------------------------+
//| Return the index of the most recent unbroken swing high.        |
//| Returns -1 if none found.                                        |
//+------------------------------------------------------------------+
int FindProtectedHigh()
{
   int      best = -1;
   datetime bestT = 0;
   for(int i = 0; i < swingTotal; i++)
   {
      if(swingList[i].type != SWING_HIGH) continue;
      if(swingList[i].broken)             continue;
      if(swingList[i].time > bestT)       { bestT = swingList[i].time; best = i; }
   }
   return best;
}

//+------------------------------------------------------------------+
//| Return the index of the most recent unbroken swing low.         |
//| Returns -1 if none found.                                        |
//+------------------------------------------------------------------+
int FindProtectedLow()
{
   int      best = -1;
   datetime bestT = 0;
   for(int i = 0; i < swingTotal; i++)
   {
      if(swingList[i].type != SWING_LOW) continue;
      if(swingList[i].broken)            continue;
      if(swingList[i].time > bestT)      { bestT = swingList[i].time; best = i; }
   }
   return best;
}

//+------------------------------------------------------------------+
//| Create a new StructureRecord.                                    |
//+------------------------------------------------------------------+
void STRUCT_Create(int stype, int dir, double level,
                   datetime swingTime, datetime breakTime,
                   int biasBefore, int biasAfter)
{
   if(strTotal >= STRUCT_MAX) { Print("BOS_CHoCH_Detector: struct limit reached"); return; }
   int i = strTotal++;
   strList[i].id         = nextStrId++;
   strList[i].stype      = stype;
   strList[i].dir        = dir;
   strList[i].level      = level;
   strList[i].swingTime  = swingTime;
   strList[i].breakTime  = breakTime;
   strList[i].biasBefore = biasBefore;
   strList[i].biasAfter  = biasAfter;
   strList[i].active     = true;
   strList[i].drawn      = false;
}

//+------------------------------------------------------------------+
//| Check bar sh for a structure break against both protected levels.|
//|                                                                  |
//| Upside break  → Bullish BOS (if bias==BULL) or Bullish CHoCH    |
//| Downside break→ Bearish BOS (if bias==BEAR) or Bearish CHoCH    |
//|                                                                  |
//| Confirmation mode (InpConfirmMode):                              |
//|   CONFIRM_CLOSE → use barClose for the break value              |
//|   CONFIRM_WICK  → use barHigh (up) / barLow (down)             |
//+------------------------------------------------------------------+
void CheckStructureBreak(int sh)
{
   double   barClose = iClose(_Symbol, InpTF, sh);
   double   barHigh  = iHigh (_Symbol, InpTF, sh);
   double   barLow   = iLow  (_Symbol, InpTF, sh);
   datetime barT     = iTime (_Symbol, InpTF, sh);

   double breakUp = (InpConfirmMode == CONFIRM_WICK) ? barHigh  : barClose;
   double breakDn = (InpConfirmMode == CONFIRM_WICK) ? barLow   : barClose;

   // ── Upside break: above the most recent unbroken swing high ──────
   int hiIdx = FindProtectedHigh();
   if(hiIdx >= 0 && swingList[hiIdx].time < barT && breakUp > swingList[hiIdx].price)
   {
      int stype      = (gBias == BIAS_BULL) ? STR_BOS_BULL : STR_CHOCH_BULL;
      int biasBefore = gBias;
      int biasAfter  = BIAS_BULL;

      STRUCT_Create(stype, +1, swingList[hiIdx].price,
                    swingList[hiIdx].time, barT, biasBefore, biasAfter);
      swingList[hiIdx].broken = true;
      gBias = biasAfter;

      if(InpShowLog)
         PrintFormat("%s | id=%d | price=%.5f | time=%s | bias_before=%s | bias_after=%s",
            (stype == STR_BOS_BULL) ? "BULLISH_BOS" : "BULLISH_CHOCH",
            nextStrId - 1, swingList[hiIdx].price,
            TimeToString(barT, TIME_DATE|TIME_MINUTES),
            BiasName(biasBefore), BiasName(biasAfter));
   }

   // ── Downside break: below the most recent unbroken swing low ─────
   int loIdx = FindProtectedLow();
   if(loIdx >= 0 && swingList[loIdx].time < barT && breakDn < swingList[loIdx].price)
   {
      int stype      = (gBias == BIAS_BEAR) ? STR_BOS_BEAR : STR_CHOCH_BEAR;
      int biasBefore = gBias;
      int biasAfter  = BIAS_BEAR;

      STRUCT_Create(stype, -1, swingList[loIdx].price,
                    swingList[loIdx].time, barT, biasBefore, biasAfter);
      swingList[loIdx].broken = true;
      gBias = biasAfter;

      if(InpShowLog)
         PrintFormat("%s | id=%d | price=%.5f | time=%s | bias_before=%s | bias_after=%s",
            (stype == STR_BOS_BEAR) ? "BEARISH_BOS" : "BEARISH_CHOCH",
            nextStrId - 1, swingList[loIdx].price,
            TimeToString(barT, TIME_DATE|TIME_MINUTES),
            BiasName(biasBefore), BiasName(biasAfter));
   }
}

//+------------------------------------------------------------------+
//| Draw a swing high/low marker for one swing record.              |
//|                                                                  |
//|   Swing High → ▼ (code 234) placed at the high price           |
//|   Swing Low  → ▲ (code 233) placed at the low price            |
//| Width 1 keeps markers small.  Broken swings get half opacity.   |
//+------------------------------------------------------------------+
void SWING_DrawMarker(int idx)
{
   if(!InpShowSwings) return;
   bool isHigh = (swingList[idx].type == SWING_HIGH);
   int  opac   = swingList[idx].broken ? InpSwingOpacity / 2 : InpSwingOpacity;
   color clr   = BlendWithBg(InpSwingClr, opac);
   string nm   = "SMCBOS_sw_" + IntegerToString(swingList[idx].id);

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
//| Draw all swing markers that have not been drawn yet.            |
//+------------------------------------------------------------------+
void SWING_DrawNew()
{
   if(!InpShowSwings) return;
   for(int i = 0; i < swingTotal; i++)
   {
      if(swingList[i].drawn) continue;
      SWING_DrawMarker(i);
      swingList[i].drawn = true;
   }
}

//+------------------------------------------------------------------+
//| Draw the horizontal line and label for one structure event.     |
//|                                                                  |
//|   BOS   → STYLE_SOLID line                                       |
//|   CHoCH → STYLE_DASH  line                                       |
//| Line runs from the swing candle to the break candle.            |
//| Label "BOS" / "CHoCH" is anchored at the break bar.             |
//+------------------------------------------------------------------+
void STRUCT_DrawLine(int idx)
{
   bool isBos = (strList[idx].stype == STR_BOS_BULL ||
                 strList[idx].stype == STR_BOS_BEAR);

   if( isBos && !InpShowBos)   return;
   if(!isBos && !InpShowChoch) return;

   // ── Colour ────────────────────────────────────────────────────────
   color rawClr;
   switch(strList[idx].stype)
   {
      case STR_BOS_BULL:   rawClr = InpBullBosClr;   break;
      case STR_BOS_BEAR:   rawClr = InpBearBosClr;   break;
      case STR_CHOCH_BULL: rawClr = InpBullChochClr; break;
      default:             rawClr = InpBearChochClr; break;
   }
   color clr = BlendWithBg(rawClr, InpLineOpacity);

   string pfx     = "SMCBOS_str_" + IntegerToString(strList[idx].id);
   string objLine = pfx + "_line";
   string objLbl  = pfx + "_lbl";

   // ── Horizontal level line ─────────────────────────────────────────
   if(ObjectCreate(0, objLine, OBJ_TREND, 0,
                   strList[idx].swingTime, strList[idx].level,
                   strList[idx].breakTime, strList[idx].level))
   {
      ObjectSetInteger(0, objLine, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, objLine, OBJPROP_STYLE,      isBos ? STYLE_SOLID : STYLE_DASH);
      ObjectSetInteger(0, objLine, OBJPROP_WIDTH,      1);
      ObjectSetInteger(0, objLine, OBJPROP_RAY_RIGHT,  false);
      ObjectSetInteger(0, objLine, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLine, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, objLine, OBJPROP_BACK,       true);
   }

   // ── Label at break bar ────────────────────────────────────────────
   string lbl = isBos ? "BOS" : "CHoCH";
   if(ObjectCreate(0, objLbl, OBJ_TEXT, 0,
                   strList[idx].breakTime, strList[idx].level))
   {
      ObjectSetString( 0, objLbl, OBJPROP_TEXT,       lbl);
      ObjectSetInteger(0, objLbl, OBJPROP_COLOR,      clr);
      ObjectSetInteger(0, objLbl, OBJPROP_FONTSIZE,   7);
      ObjectSetInteger(0, objLbl, OBJPROP_ANCHOR,
         strList[idx].dir > 0 ? ANCHOR_LEFT_LOWER : ANCHOR_LEFT_UPPER);
      ObjectSetInteger(0, objLbl, OBJPROP_SELECTABLE, false);
      ObjectSetInteger(0, objLbl, OBJPROP_HIDDEN,     true);
      ObjectSetInteger(0, objLbl, OBJPROP_BACK,       false);
   }

   strList[idx].drawn = true;
}

//+------------------------------------------------------------------+
//| Draw all structure events that have not been drawn yet.         |
//+------------------------------------------------------------------+
void STRUCT_DrawNew()
{
   for(int i = 0; i < strTotal; i++)
   {
      if(strList[i].drawn) continue;
      STRUCT_DrawLine(i);
   }
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| Remove all chart objects belonging to this indicator.           |
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
//| OnInit: detect swings → historical structure replay → draw      |
//+------------------------------------------------------------------+
int OnInit()
{
   DeleteAll();
   swingTotal  = 0; strTotal  = 0;
   nextSwingId = 0; nextStrId = 0;
   gBias = BIAS_NEUTRAL;

   int avail = iBars(_Symbol, InpTF);
   if(avail < InpSwingLeft + InpSwingRight + 2)
   { Print("BOS_CHoCH_Detector: not enough bars."); return INIT_FAILED; }

   int limit = MathMin(InpLookback, avail - InpSwingLeft - 2);

   // ── Step 1: Detect all confirmed swings in the lookback window ───
   // Scan from oldest bar (shift=limit) toward newest (shift=InpSwingRight+1).
   // A swing at sh needs InpSwingRight right-side bars, so minimum sh = InpSwingRight+1.
   for(int sh = limit; sh >= InpSwingRight + 1; sh--)
      SWING_ScanBar(sh);

   // ── Step 2: Historical structure-break replay ─────────────────────
   // Walk every bar oldest → newest.  For each bar check whether it
   // closed through a protected level, creating a BOS or CHoCH.
   // The filter swingTime < barT inside CheckStructureBreak ensures only
   // swings that predate the current bar are considered.
   for(int sh = limit; sh >= 1; sh--)
      CheckStructureBreak(sh);

   // ── Step 3: Draw everything ───────────────────────────────────────
   SWING_DrawNew();
   STRUCT_DrawNew();

   // ── Step 4: Summary ───────────────────────────────────────────────
   int nBull_bos=0, nBear_bos=0, nBull_choch=0, nBear_choch=0;
   for(int i = 0; i < strTotal; i++)
   {
      if     (strList[i].stype == STR_BOS_BULL)   nBull_bos++;
      else if(strList[i].stype == STR_BOS_BEAR)   nBear_bos++;
      else if(strList[i].stype == STR_CHOCH_BULL) nBull_choch++;
      else                                         nBear_choch++;
   }
   int nBroken = 0;
   for(int i = 0; i < swingTotal; i++) if(swingList[i].broken) nBroken++;

   PrintFormat("BOS_CHoCH_Detector v1 ready | swings=%d (broken=%d) | "
               "BOS bull=%d bear=%d | CHoCH bull=%d bear=%d | "
               "bias=%s | %s %s",
               swingTotal, nBroken,
               nBull_bos, nBear_bos, nBull_choch, nBear_choch,
               BiasName(gBias), _Symbol, EnumToString(InpTF));

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
//| OnDeinit: clean up chart objects                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   DeleteAll();
   ChartRedraw(0);
}

//+------------------------------------------------------------------+
//| OnCalculate: bar-open processing only                            |
//|                                                                  |
//| Order each new bar:                                              |
//|   1. Confirm the swing that now has InpSwingRight closed bars   |
//|      to its right (shift = InpSwingRight + 1).                  |
//|   2. Check if bar 1 (the bar that just closed) broke any level. |
//|   3. Draw any new swings or structure breaks.                    |
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

   // 1. Newly confirmable swing: bar 1 is the InpSwingRight-th right bar
   //    for the candle at shift InpSwingRight + 1.
   SWING_ScanBar(InpSwingRight + 1);

   // 2. Check if bar 1 broke a protected high or low.
   CheckStructureBreak(1);

   // 3. Render new swings and structure breaks.
   SWING_DrawNew();
   STRUCT_DrawNew();

   return rates_total;
}
`;
}
